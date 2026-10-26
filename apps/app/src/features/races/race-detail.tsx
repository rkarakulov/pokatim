import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type MyRaceDisputes, type MyRaceEntry, type RaceDetail } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonHeroCard,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { SectionHero } from '@/components/section-hero';
import { isSessionPending, isSignedIn, useSessionStore } from '@/features/auth/session-store';
import {
  domainLabel,
  formatDistances,
  heroDateText,
  meta,
  minskDateTime,
} from '@/lib/minsk-format';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { canOpenRival } from './disputes/dispute-format';
import { useMyRaceDisputes } from './disputes/queries';
import { RaceDisputes } from './disputes/race-disputes';
import { cancelMessage, formatRaceWindow, raceCardLine } from './format';
import { RaceParticipation } from './participation/race-participation';
import { showsResultsTable } from './participation-format';
import { useMyRaceEntry, useRace, useRaceResults } from './queries';
import { RaceRouteMap } from './race-route-map';
import { RaceResultsTable } from './results-table';

export const raceDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;

/** Строка карточки: подпись и значение (текст или ссылка). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{label}</Text>
      {typeof children === 'string' ? (
        <Text style={[textStyle('body'), { color: theme.text.primary }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

/**
 * Поля гонки (§3): типографский герой (без карты), окно по фазе сервера, допуск коридора (race-results-01), дистанция
 * («по GPS-треку» при коридоре), класс, покрытия, сезон ссылкой, плановая дата протокола, описание как есть (`Text`:
 * без разметки и автоссылок). Отменённая — баннер с причиной, строк окна нет. Даты — с годом (не зависят от «сейчас»);
 * «сегодня / завтра» — после монтирования (`now`). `'unknown'` — без строки и подписи (R9).
 */
function RaceDetailView({
  race,
  now,
  entry,
  disputes,
  results,
  signedIn,
  sessionPending,
}: {
  race: RaceDetail;
  now: Date | null;
  entry: UseQueryResult<MyRaceEntry | null>;
  disputes: UseQueryResult<MyRaceDisputes | null>;
  results: ReturnType<typeof useRaceResults>;
  signedIn: boolean;
  sessionPending: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const bikeClass = domainLabel('domain.bikeClass', race.bikeClass);
  const surfaces = meta(race.surfaces.map((surface) => domainLabel('domain.surface', surface)));
  const cancelled = race.phase === 'cancelled';
  const window = formatRaceWindow(race.windowStartsAt, race.windowEndsAt, null);
  const line = raceCardLine(race, now, true);
  // старый API поля не присылает — как без коридора
  const corridor = race.corridor ?? null;

  return (
    <View style={styles.detail}>
      <SectionHero
        kicker={bikeClass ? t('races.detail.kicker', { bikeClass }) : t('races.detail.title')}
        date={window}
        title={race.title}
      />
      {cancelled ? <Banner tone="info" message={cancelMessage(race.cancelReason)} /> : null}
      <RaceParticipation
        race={race}
        now={now}
        entry={entry}
        signedIn={signedIn}
        sessionPending={sessionPending}
      />
      {signedIn ? <RaceDisputes raceId={race.id} disputes={disputes} /> : null}
      {cancelled ? null : (
        <Row label={t('races.detail.window')}>
          <View style={styles.value}>
            <Text style={[textStyle('body'), { color: theme.text.primary }]}>
              {t('races.detail.windowValue', {
                dates: heroDateText(window),
                closeTime: minskDateTime(race.windowEndsAt, null).time,
              })}
            </Text>
            {line ? (
              <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{line}</Text>
            ) : null}
          </View>
        </Row>
      )}
      {corridor ? (
        <Row label={t('races.detail.corridor')}>
          {t('races.detail.corridorValue', { width: corridor.widthM })}
        </Row>
      ) : null}
      {/* карта маршрута с коридором (maps-01): без коридора — ничего */}
      <RaceRouteMap race={race} />
      <Row label={t('races.detail.distance')}>
        {corridor
          ? t('races.detail.distanceByRoute', {
              distance: formatDistances([race.distanceKm]) ?? '',
            })
          : (formatDistances([race.distanceKm]) ?? '')}
      </Row>
      {bikeClass ? <Row label={t('races.detail.bikeClass')}>{bikeClass}</Row> : null}
      {surfaces ? <Row label={t('races.detail.surfaces')}>{surfaces}</Row> : null}
      {race.season ? (
        <Row label={t('races.detail.season')}>
          <View style={styles.link}>
            <TextAction
              label={race.season.name}
              onPress={() => router.push(`/seasons/${race.season?.id ?? ''}`)}
            />
          </View>
        </Row>
      ) : null}
      {cancelled ? null : (
        <Row label={t('races.detail.protocol')}>
          {t('races.detail.protocolPlanned', {
            date: minskDateTime(race.protocolPlannedAt, null).date,
          })}
        </Row>
      )}
      {race.description ? (
        <Row label={t('races.detail.description')}>
          <Text selectable style={[textStyle('body'), { color: theme.text.primary }]}>
            {race.description}
          </Text>
        </Row>
      ) : null}
      {showsResultsTable(race) ? (
        <RaceResultsTable
          results={results}
          ownEntryId={signedIn ? (entry.data?.entry?.id ?? null) : null}
          // карточка соперника — только вошедшему участнику, когда ей есть что показать (RC-14)
          rowAction={(entryId) =>
            signedIn && canOpenRival(disputes.data, entryId)
              ? () => router.push(`/races/result/${race.id}/${entryId}`)
              : null
          }
        />
      ) : null}
    </View>
  );
}

/**
 * Публичная карточка гонки (`/races/<id>`, вне гардов: гость и вошедший, R4а): данные — API через TanStack Query, на
 * web — посев SSR (`seed`). Невалидный id — «Гонка не найдена» без запроса; 404 (черновик и неизвестная неотличимы,
 * R6) — то же; сеть и сервер — `AsyncContent`. Обновление — фокус и pull-to-refresh.
 */
export function RaceDetailScreen({ id, seed }: { id: string; seed: RaceDetail | undefined }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const signedIn = useSessionStore(isSignedIn);
  const sessionPending = useSessionStore((state) => isSessionPending(state.status));
  const race = useRace(id, seed, valid);
  // участие и таблица — только клиентские запросы (в SSR не попадают): `loader` сеет лишь `RaceDetail`
  const entry = useMyRaceEntry(id, valid && signedIn);
  // споры (race-results-06) — только у вошедшего с заявкой (RC-14)
  const entered = signedIn && (entry.data?.entry ?? null) !== null;
  const disputes = useMyRaceDisputes(id, valid && entered);
  const tableShown = race.data !== undefined && showsResultsTable(race.data);
  const results = useRaceResults(id, valid && tableShown);
  const now = useMinskClockAfterMount([race.dataUpdatedAt, entry.dataUpdatedAt]);
  const refetchers = useMemo(
    () => [
      race.refetch,
      ...(signedIn ? [entry.refetch] : []),
      ...(entered ? [disputes.refetch] : []),
      ...(tableShown ? [results.refetch] : []),
    ],
    [race.refetch, signedIn, entry.refetch, entered, disputes.refetch, tableShown, results.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  const notFound =
    !valid || (race.data === undefined && apiErrorOf(race.error)?.code === 'NOT_FOUND');
  // «назад» без истории и «Все гонки»: вкладки — только для вошедших, гостю — корень (дальше решает гард)
  const home = signedIn ? '/races' : '/';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={raceDocumentTitle(
          race.data && !notFound ? race.data.title : t('races.detail.title'),
        )}
      />
      <DetailHeader title={notFound ? undefined : race.data?.title} fallback={home} />
      <ScrollView
        testID="race-detail"
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
        <OfflineBanner hasData={race.data !== undefined && !notFound} style={styles.offline} />
        {notFound ? (
          <EmptyState
            title={t('races.detail.notFound')}
            action={{
              label: t('races.detail.allRaces'),
              onPress: () => router.navigate(home),
            }}
          />
        ) : (
          <AsyncContent
            query={race}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
              </View>
            }
          >
            {(data) => (
              <RaceDetailView
                race={data}
                now={now}
                entry={entry}
                disputes={disputes}
                results={results}
                signedIn={signedIn}
                sessionPending={sessionPending}
              />
            )}
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
  row: { gap: space.s1 },
  value: { gap: space.s1 },
  link: { alignItems: 'flex-start' },
});
