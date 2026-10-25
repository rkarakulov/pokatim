import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type CalendarStartDetail } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { i18n, t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  Kicker,
  SkeletonHeroCard,
  SkeletonText,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { SectionHero } from '@/components/section-hero';
import { StatBlock } from '@/components/stat-block';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { domainLabel } from '@/lib/minsk-format';
import { openExternalUrl } from '@/lib/open-external-url';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { formatCalendarStartDate, startPlaceLine } from './format';
import { useCalendarStart } from './queries';
import { registrationLink } from './registration';

export const calendarDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;

const km = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });

/**
 * Регистрация у организатора (Q4, Q8): безопасная ссылка и фаза не `finished` — primary-кнопка и пояснение под ней;
 * нажатие — системный браузер (`openExternalUrl`, синхронно в обработчике). `ongoing` — «Идёт сейчас.» над кнопкой,
 * `finished` — «Старт прошёл.» без кнопки. Ошибка открытия — баннер; адрес не логируется.
 */
function Registration({ start }: { start: CalendarStartDetail }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const url = registrationLink(start);
  const status =
    start.phase === 'finished'
      ? t('calendar.detail.finished')
      : start.phase === 'ongoing'
        ? t('calendar.ongoing')
        : null;
  if (!status && !url) return null;

  const open = (link: string) => {
    setFailed(false);
    openExternalUrl(link).catch(() => setFailed(true));
  };

  return (
    <View style={styles.registration}>
      {status ? (
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{status}</Text>
      ) : null}
      {url ? (
        <>
          <Button label={t('calendar.detail.register')} onPress={() => open(url)} />
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('calendar.detail.registerHint')}
          </Text>
          {failed ? <Banner tone="warning" message={t('calendar.detail.openFailed')} /> : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * Поля старта (§3): кикер раздела, типографский герой (строка «{Дисциплина} · массовый старт · вне приложения»,
 * дата с годом, название), строка времени и места, дистанции `StatBlock`, регистрация, «О старте» как текст (без
 * разметки и автоссылок). Даты не зависят от «сейчас» (SSR = гидрация); фаза — только с сервера. `'unknown'` — без
 * подписи и строки (R9). Медиа, комментарии и кросс-ссылки скрыты (§4).
 */
function CalendarDetailView({ start }: { start: CalendarStartDetail }) {
  const theme = useTheme();
  const discipline = domainLabel('domain.discipline', start.discipline);
  const place = startPlaceLine(start);

  return (
    <View style={styles.detail}>
      <Kicker label={t('calendar.kicker')} />
      <SectionHero
        kicker={
          discipline
            ? t('calendar.detail.line', { discipline })
            : t('calendar.detail.lineNoDiscipline')
        }
        date={formatCalendarStartDate(start, null)}
        title={start.title}
      />
      {place ? (
        <Text style={[textStyle('body'), { color: theme.text.primary }]}>{place}</Text>
      ) : null}
      {start.distancesKm.length > 0 ? (
        <StatBlock
          items={start.distancesKm.map((distance) => ({
            value: km(distance),
            unit: t('calendar.detail.km'),
            label: t('calendar.detail.distance'),
          }))}
        />
      ) : null}
      <Registration start={start} />
      {start.description ? (
        <View style={styles.about}>
          <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
            {t('calendar.detail.about')}
          </Text>
          <Text selectable style={[textStyle('body'), { color: theme.text.primary }]}>
            {start.description}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Публичная карточка старта (`/calendar/<id>`, вне гардов: гость и вошедший): данные — API через TanStack Query, на
 * web — посев SSR (`seed`). Невалидный id — «Старт не найден» без запроса; 404 (снятый и неизвестный неотличимы) —
 * то же; сеть и сервер — `AsyncContent`. Обновление — фокус и pull-to-refresh.
 */
export function CalendarDetailScreen({
  id,
  seed,
}: {
  id: string;
  seed: CalendarStartDetail | undefined;
}) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const signedIn = useSessionStore(isSignedIn);
  const start = useCalendarStart(id, seed, valid);
  const refetchers = useMemo(() => [start.refetch], [start.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  const notFound =
    !valid || (start.data === undefined && apiErrorOf(start.error)?.code === 'NOT_FOUND');
  // «назад» без истории и «Все старты»: вкладки — только для вошедших, гостю — корень (дальше решает гард)
  const home = signedIn ? '/calendar' : '/';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={calendarDocumentTitle(
          start.data && !notFound ? start.data.title : t('calendar.detail.title'),
        )}
      />
      <DetailHeader title={notFound ? undefined : start.data?.title} fallback={home} />
      <ScrollView
        testID="calendar-detail"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.text.secondary}
            colors={[theme.text.primary]}
            progressBackgroundColor={theme.surface.raised}
          />
        }
      >
        <OfflineBanner hasData={start.data !== undefined && !notFound} style={styles.offline} />
        {notFound ? (
          <EmptyState
            title={t('calendar.detail.notFound')}
            action={{
              label: t('calendar.detail.allStarts'),
              onPress: () => router.navigate(home),
            }}
          />
        ) : (
          <AsyncContent
            query={start}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
              </View>
            }
          >
            {(data) => <CalendarDetailView start={data} />}
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  detail: { gap: space.s4 },
  offline: { paddingBottom: space.s3 },
  registration: { gap: space.s2 },
  about: { gap: space.s1 },
});
