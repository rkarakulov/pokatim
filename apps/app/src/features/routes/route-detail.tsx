import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type CatalogRouteDetail } from '@pokatim/contracts';
import { size, space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { createScrubStore, PROFILE_ASPECT_RATIO, type ScrubStore } from '@pokatim/route-view';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  Pill,
  SkeletonGroup,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { sheetColors, sheetStyles } from '@/components/bottom-sheet-props';
import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { RaceListCard, RaceListCardSkeleton } from '@/components/race-list-card';
import { StatBlock } from '@/components/stat-block';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { shareLink, shareOrigin } from '@/lib/share-link';
import { useMinskClockAfterMount, useMounted } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { CatalogRouteMap } from './catalog-route-map';
import { ElevationProfile } from './elevation-profile';
import { routeChips, routeShareDescription, routeStatItems } from './format';
import { useCatalogRoute, useCatalogRouteRaces } from './queries';
import { useScrubScrollEnabled } from './use-scrub-scroll-lock';

export const routeDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;
export const routePath = (id: string) => `/routes/${encodeURIComponent(id)}`;

/**
 * Действия карточки (routes-04d, RC-11): «Поделиться» (primary; share sheet / Web Share / копирование с «Ссылка
 * скопирована»; нет origin — кнопки нет, появляется после монтирования) и «Скачать GPX» (secondary, только при
 * `gpxAvailable`; web скачивает в той же вкладке, native открывает системный браузер; адрес не логируется) — в одну
 * строку поровну, одна кнопка — во всю ширину. Уведомления — во всю ширину под строкой.
 */
function RouteActions({ route, mounted }: { route: CatalogRouteDetail; mounted: boolean }) {
  const [shareNotice, setShareNotice] = useState<'copied' | 'failed' | null>(null);
  const [gpxFailed, setGpxFailed] = useState(false);
  const canShare = mounted && shareOrigin() !== null;
  if (!canShare && !route.gpxAvailable) return null;
  const share = () => {
    setShareNotice(null);
    shareLink({ title: route.title, text: routeShareDescription(route), path: routePath(route.id) })
      .then((outcome) => setShareNotice(outcome === 'copied' ? 'copied' : null))
      .catch(() => setShareNotice('failed'));
  };
  const download = () => {
    setGpxFailed(false);
    // синхронно в обработчике нажатия (web: клик по ссылке до любого await)
    downloadFile(api.catalogRouteGpxUrl(route.id)).catch(() => setGpxFailed(true));
  };
  return (
    <View style={styles.stack}>
      <View testID="route-actions" style={styles.actions}>
        {canShare ? (
          <View style={styles.action}>
            <Button label={t('routes.detail.share')} variant="primary" onPress={share} />
          </View>
        ) : null}
        {route.gpxAvailable ? (
          <View style={styles.action}>
            <Button label={t('routes.detail.gpx')} variant="secondary" onPress={download} />
          </View>
        ) : null}
      </View>
      {shareNotice === 'copied' ? <Banner message={t('routes.detail.copied')} /> : null}
      {shareNotice === 'failed' ? (
        <Banner tone="warning" message={t('routes.detail.shareFailed')} />
      ) : null}
      {gpxFailed ? <Banner tone="warning" message={t('routes.detail.gpxFailed')} /> : null}
    </View>
  );
}

/**
 * «Гонки на маршруте» (RC-12): публичные гонки с коридором по этому маршруту, новые сверху; ссылки на `races/<id>`,
 * «Показать ещё». Состояния §4.12: первая загрузка — заголовок и скелетон карточек; подтверждённо пусто и ошибка без
 * данных (в т. ч. 404) — блока нет (тихо, как карта; карточка цела); ошибка обновления — карточки остаются, баннер с
 * повтором; догрузка — скелетон под списком, ошибка следующей страницы — баннер с повтором. Даты — с годом.
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
  const loading = races.isPending && races.fetchStatus === 'fetching';
  const items = races.data?.pages.flatMap((page) => page.items) ?? [];
  if (!loading && items.length === 0) return null;
  // идёт обновление — не догружаем: fetchNextPage по умолчанию отменил бы refetch (ревью pass 1 блока 04)
  const loadMore = () => {
    if (races.hasNextPage && !races.isFetching) void races.fetchNextPage({ cancelRefetch: false });
  };
  const refreshFailed = races.data !== undefined && races.isError && !races.isFetchNextPageError;
  return (
    <View>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), styles.racesTitle, { color: theme.text.primary }]}
      >
        {t('routes.detail.races')}
      </Text>
      {loading ? (
        <View testID="route-races-skeleton">
          <SkeletonGroup>
            <RaceListCardSkeleton />
            <RaceListCardSkeleton />
          </SkeletonGroup>
        </View>
      ) : null}
      {refreshFailed ? (
        <View style={styles.racesNotice}>
          <Banner tone="warning" title={t('state.staleTitle')} message={t('state.staleMessage')} />
          <TextAction label={t('state.retry')} onPress={() => void races.refetch()} />
        </View>
      ) : null}
      {items.map((race) => (
        <RaceListCard
          key={race.id}
          race={race}
          now={now}
          datesWithYear
          onPress={() => router.push(`/races/${race.id}`)}
        />
      ))}
      {races.isFetchNextPageError ? (
        <View style={styles.racesNotice}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <TextAction
            label={t('state.retry')}
            onPress={() => void races.fetchNextPage({ cancelRefetch: false })}
          />
        </View>
      ) : races.isFetchingNextPage ? (
        <SkeletonGroup>
          <RaceListCardSkeleton />
        </SkeletonGroup>
      ) : races.hasNextPage ? (
        <View style={styles.more}>
          <TextAction label={t('routes.detail.racesMore')} onPress={loadMore} />
        </View>
      ) : null}
    </View>
  );
}

/** Шапка шторки (routes-04d, L3): компактная строка цифр — видна и в свёрнутой шторке. */
function RouteSheetHeader({ route }: { route: CatalogRouteDetail }) {
  return (
    <View style={styles.sheetHeader}>
      <StatBlock variant="compact" items={routeStatItems(route)} />
    </View>
  );
}

/**
 * Тело шторки карточки маршрута (routes-03, P1; routes-04d, L3): без названия (оно в шапке экрана), чипы (покрытия,
 * форма, город; `'unknown'` — без чипа), профиль высоты без заголовка со скраббингом, действия в строку, «Гонки на
 * маршруте».
 */
function RouteSheetBody({
  route,
  races,
  now,
  mounted,
  scrub,
}: {
  route: CatalogRouteDetail;
  races: ReturnType<typeof useCatalogRouteRaces>;
  now: Date | null;
  mounted: boolean;
  scrub: ScrubStore;
}) {
  return (
    <View style={styles.detail}>
      <View testID="route-chips" style={styles.chips}>
        {routeChips(route).map((chip) => (
          <Pill key={chip} label={chip} />
        ))}
      </View>
      <ElevationProfile
        elevation={route.elevation}
        distanceM={route.distanceM}
        gainM={route.elevationGainM}
        scrub={scrub}
      />
      <RouteActions route={route} mounted={mounted} />
      <RouteRaces races={races} now={now} />
    </View>
  );
}

/** Прокрутка состояния без карты (404, ошибка без данных) — с pull-to-refresh, как прежде. */
function StateScroll({
  refresh,
  children,
}: {
  refresh: ScrollViewProps['refreshControl'];
  children: ReactNode;
}) {
  return (
    <ScrollView
      testID="route-detail"
      contentContainerStyle={styles.content}
      refreshControl={refresh}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Скелетон карточки (RC-18) — та же раскладка: место карты на всю область и шторка-скелетон (строка цифр, место
 * профиля); без жестов.
 */
function RouteDetailSkeleton() {
  const theme = useTheme<AppTheme>();
  const block = { backgroundColor: theme.surface.skeleton };
  return (
    <View testID="route-detail-skeleton" style={styles.area}>
      <View style={[StyleSheet.absoluteFill, block]} />
      <View style={[sheetStyles.sheet, sheetColors(theme)]}>
        <View style={sheetStyles.grabber} />
        <View style={[styles.sheetHeader, styles.skeletonSheet]}>
          <SkeletonGroup>
            <SkeletonText variant="bodyStrong" lines={2} lastLineWidth="60%" />
            <View style={[styles.profilePlace, block]} />
          </SkeletonGroup>
        </View>
      </View>
    </View>
  );
}

/**
 * Публичная карточка маршрута каталога (`/routes/<id>`, вне гардов: гость и вошедший, RC-9): данные — API через
 * TanStack Query, на web — посев SSR (`seed`). Невалидный id — «Маршрут недоступен» без запроса; 404 (снят, не
 * опубликован, неизвестен — неотличимы) — то же; сеть и сервер — `AsyncContent`. Обновление — фокус и
 * pull-to-refresh (карточка и гонки; геометрия неизменна). routes-04d (RC-4, RC-18): под шапкой — карта на всю область
 * и шторка поверх (состояние `expanded` — здесь, SSR — развёрнута); видимая высота шторки — отступ камеры; тело
 * шторки — прокрутка с pull-to-refresh и блокировкой на время скраббинга. 404 и ошибка без данных — без карты и
 * шторки.
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
  // routes-04: стор скраббинга профиля и карты — на экземпляр экрана; native — жест по профилю или маркеру выключает
  // прокрутку (ре-рендер экрана — в начале и в конце жеста), web — нет (M2); прокрутка скрывает курсор (RC-3, RC-8)
  const [scrub] = useState(createScrubStore);
  useEffect(() => {
    // другой маршрут в том же экземпляре экрана — позиция с начала
    scrub.setState({ fraction: 0, active: false, dragging: null });
  }, [id, scrub]);
  const scrollEnabled = useScrubScrollEnabled(scrub);
  // routes-04d (RC-2, RC-5): шторка — состояние экрана; высота — после измерения (до неё карта не монтируется)
  const [expanded, setExpanded] = useState(true);
  const [sheetHeight, setSheetHeight] = useState<number | undefined>(undefined);
  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      tintColor={theme.text.secondary}
      colors={[theme.text.primary]}
      progressBackgroundColor={theme.surface.raised}
    />
  );

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
      <OfflineBanner hasData={route.data !== undefined && !notFound} style={styles.offline} />
      {notFound ? (
        <StateScroll refresh={refresh}>
          <EmptyState
            title={t('routes.detail.notFound')}
            action={{
              label: t('routes.detail.allRoutes'),
              onPress: () => router.navigate(home),
            }}
          />
        </StateScroll>
      ) : route.data !== undefined ? (
        <View style={styles.area}>
          <View style={StyleSheet.absoluteFill}>
            {/* нет профиля — нет маркера: синхронизировать нечего (routes-04) */}
            <CatalogRouteMap
              route={route.data}
              scrub={route.data.elevation ? scrub : undefined}
              fill
              bottomInset={sheetHeight}
            />
          </View>
          <BottomSheet
            expanded={expanded}
            onExpandedChange={setExpanded}
            onVisibleHeightChange={setSheetHeight}
            collapseLabel={t('routes.detail.sheet.collapse')}
            expandLabel={t('routes.detail.sheet.expand')}
            header={<RouteSheetHeader route={route.data} />}
          >
            <ScrollView
              testID="route-detail"
              contentContainerStyle={styles.sheetContent}
              scrollEnabled={scrollEnabled}
              onScrollBeginDrag={() => {
                if (scrub.getState().active) scrub.setState({ active: false });
              }}
              refreshControl={refresh}
            >
              <AsyncContent query={route} skeleton={null}>
                {(data) => (
                  <RouteSheetBody
                    route={data}
                    races={races}
                    now={now}
                    mounted={mounted}
                    scrub={scrub}
                  />
                )}
              </AsyncContent>
            </ScrollView>
          </BottomSheet>
        </View>
      ) : route.isPending && route.fetchStatus !== 'paused' ? (
        <RouteDetailSkeleton />
      ) : (
        <StateScroll refresh={refresh}>
          <AsyncContent query={route} skeleton={null}>
            {() => null}
          </AsyncContent>
        </StateScroll>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  // область карты под шапкой: карта — на всю, шторка — поверх (касания до карты под ней не доходят)
  area: { flex: 1, overflow: 'hidden' },
  sheetHeader: { paddingHorizontal: size.gutter, paddingBottom: space.s3 },
  sheetContent: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  skeletonSheet: { gap: space.s4 },
  detail: { gap: space.s4 },
  offline: { paddingHorizontal: size.gutter, paddingBottom: space.s3 },
  profilePlace: { width: '100%', aspectRatio: PROFILE_ASPECT_RATIO },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  stack: { gap: space.s3 },
  actions: { flexDirection: 'row', gap: space.s3 },
  action: { flex: 1 },
  racesTitle: { marginBottom: space.s2 },
  more: { alignItems: 'flex-start', paddingTop: space.s2 },
  racesNotice: { gap: space.s3, paddingVertical: space.s3 },
});
