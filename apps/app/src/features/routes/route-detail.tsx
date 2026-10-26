import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type CatalogRouteDetail } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { i18n, t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  SkeletonHeroCard,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { RaceListCard } from '@/components/race-list-card';
import { SectionHero } from '@/components/section-hero';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { shareLink, shareOrigin } from '@/lib/share-link';
import { useMinskClockAfterMount, useMounted } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { CatalogRouteMap } from './catalog-route-map';
import {
  routeCity,
  routeHeroDate,
  routeKm,
  routePlace,
  routeShareDescription,
  routeSurfaces,
} from './format';
import { useCatalogRoute, useCatalogRouteRaces } from './queries';

export const routeDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;
export const routePath = (id: string) => `/routes/${encodeURIComponent(id)}`;

/** Строка карточки: подпись и значение. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{label}</Text>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>{children}</Text>
    </View>
  );
}

/** «Поделиться» ссылкой на web-карточку: share sheet / Web Share / копирование с «Ссылка скопирована». */
function ShareAction({ route }: { route: CatalogRouteDetail }) {
  const [notice, setNotice] = useState<'copied' | 'failed' | null>(null);
  const share = () => {
    setNotice(null);
    shareLink({ title: route.title, text: routeShareDescription(route), path: routePath(route.id) })
      .then((outcome) => setNotice(outcome === 'copied' ? 'copied' : null))
      .catch(() => setNotice('failed'));
  };
  return (
    <View style={styles.stack}>
      <Button label={t('routes.detail.share')} variant="secondary" onPress={share} />
      {notice === 'copied' ? <Banner message={t('routes.detail.copied')} /> : null}
      {notice === 'failed' ? (
        <Banner tone="warning" message={t('routes.detail.shareFailed')} />
      ) : null}
    </View>
  );
}

/**
 * «Гонки на маршруте» (RC-12): публичные гонки с коридором по этому маршруту, новые сверху; ссылки на `races/<id>`,
 * «Показать ещё». Пусто, 404 и ошибка без данных — блока нет (тихо, как карта; карточка цела). Даты — с годом.
 */
function RouteRaces({
  races,
  now,
}: {
  races: ReturnType<typeof useCatalogRouteRaces>;
  now: Date | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const items = races.data?.pages.flatMap((page) => page.items) ?? [];
  if (items.length === 0) return null;
  return (
    <View>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), styles.racesTitle, { color: theme.text.primary }]}
      >
        {t('routes.detail.races')}
      </Text>
      {items.map((race) => (
        <RaceListCard
          key={race.id}
          race={race}
          now={now}
          datesWithYear
          onPress={() => router.push(`/races/${race.id}`)}
        />
      ))}
      {races.hasNextPage ? (
        <View style={styles.more}>
          <TextAction
            label={t('routes.detail.racesMore')}
            onPress={() => {
              if (!races.isFetchingNextPage) void races.fetchNextPage();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Поля маршрута каталога (D4): типографский герой (длина крупно, название, город и покрытие), карта без коридора,
 * длина, набор, петля, город старта, покрытие, «Поделиться» (нет origin — кнопки нет), «Гонки на маршруте».
 * `'unknown'` в городе и покрытии — без строки (R6).
 */
function RouteDetailView({
  route,
  races,
  now,
  mounted,
}: {
  route: CatalogRouteDetail;
  races: ReturnType<typeof useCatalogRouteRaces>;
  now: Date | null;
  mounted: boolean;
}) {
  const city = routeCity(route);
  const surfaces = routeSurfaces(route);
  const place = routePlace(route);
  const canShare = mounted && shareOrigin() !== null;
  return (
    <View style={styles.detail}>
      <SectionHero
        kicker={t('routes.detail.kicker')}
        date={routeHeroDate(route)}
        title={route.title}
        meta={place ? [place] : undefined}
      />
      <CatalogRouteMap route={route} />
      <Row label={t('routes.detail.length')}>{routeKm(route.distanceM)}</Row>
      {route.elevationGainM !== null ? (
        <Row label={t('routes.detail.elevation')}>
          {t('routes.detail.elevationValue', { gain: i18n.formatNumber(route.elevationGainM) })}
        </Row>
      ) : null}
      <Row label={t('routes.detail.loop')}>
        {route.isLoop ? t('routes.detail.yes') : t('routes.detail.no')}
      </Row>
      {city ? <Row label={t('routes.detail.city')}>{city}</Row> : null}
      {surfaces ? <Row label={t('routes.detail.surface')}>{surfaces}</Row> : null}
      {canShare ? <ShareAction route={route} /> : null}
      <RouteRaces races={races} now={now} />
    </View>
  );
}

/**
 * Публичная карточка маршрута каталога (`/routes/<id>`, вне гардов: гость и вошедший, RC-9): данные — API через
 * TanStack Query, на web — посев SSR (`seed`). Невалидный id — «Маршрут недоступен» без запроса; 404 (снят, не
 * опубликован, неизвестен — неотличимы) — то же; сеть и сервер — `AsyncContent`. Обновление — фокус и
 * pull-to-refresh (карточка и гонки; геометрия неизменна).
 */
export function RouteDetailScreen({
  id,
  seed,
}: {
  id: string;
  seed: CatalogRouteDetail | undefined;
}) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const signedIn = useSessionStore(isSignedIn);
  const mounted = useMounted();
  const route = useCatalogRoute(id, seed, valid);
  // гонки маршрута — только клиент (в SSR не попадают)
  const races = useCatalogRouteRaces(id, valid && route.data !== undefined);
  const now = useMinskClockAfterMount([route.dataUpdatedAt, races.dataUpdatedAt]);
  const hasRoute = route.data !== undefined;
  const refetchers = useMemo(
    () => [route.refetch, ...(hasRoute ? [races.refetch] : [])],
    [route.refetch, hasRoute, races.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  const notFound =
    !valid || (route.data === undefined && apiErrorOf(route.error)?.code === 'NOT_FOUND');
  // «назад» без истории и «Все маршруты»: вкладки — только для вошедших, гостю — корень (дальше решает гард)
  const home = signedIn ? '/routes' : '/';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={routeDocumentTitle(
          route.data && !notFound ? route.data.title : t('routes.detail.title'),
        )}
      />
      <DetailHeader title={notFound ? undefined : route.data?.title} fallback={home} />
      <ScrollView
        testID="route-detail"
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
        <OfflineBanner hasData={route.data !== undefined && !notFound} style={styles.offline} />
        {notFound ? (
          <EmptyState
            title={t('routes.detail.notFound')}
            action={{
              label: t('routes.detail.allRoutes'),
              onPress: () => router.navigate(home),
            }}
          />
        ) : (
          <AsyncContent
            query={route}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
              </View>
            }
          >
            {(data) => <RouteDetailView route={data} races={races} now={now} mounted={mounted} />}
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
  stack: { gap: space.s3 },
  racesTitle: { marginBottom: space.s2 },
  more: { alignItems: 'flex-start', paddingTop: space.s2 },
});
