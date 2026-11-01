import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type CatalogRouteDetail, type RouteExportFormat } from '@pokatim/contracts';
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
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { sheetSurface, sheetStyles } from '@/components/bottom-sheet-props';
import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { RaceListCard, RaceListCardSkeleton } from '@/components/race-list-card';
import { StatBlock, StatBlockSkeleton } from '@/components/stat-block';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import {
  routeRidesKeys,
  useRouteRideLeaderboard,
  useRouteRides,
} from '@/features/route-rides/queries';
import { OTHERS_CARD_ROWS } from '@/features/route-rides/route-ride-format';
import { RouteRideOthersBlock } from '@/features/route-rides/route-ride-others-block';
import { RouteRidesBlock } from '@/features/route-rides/route-rides-block';
import { useShareChoice } from '@/features/sharing/share-choice-sheet';
import { useShareImage } from '@/features/sharing/use-share-image';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { shareOrigin } from '@/lib/share-link';
import { useMinskClockAfterMount, useMounted } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { useAppTheme } from '@/theme/use-app-theme';

import { CatalogRouteMap } from './catalog-route-map';
import { ElevationProfile } from './elevation-profile';
import {
  availableExportFormats,
  ROUTE_STATS_VARIANT,
  routeAuthorLabel,
  routeChips,
  routeShareDescription,
  routeStatItems,
} from './format';
import { useCatalogRoute, useCatalogRouteRaces, useCatalogRouteViewer } from './queries';
import { RouteDownloadSheet } from './route-download-sheet';
import { routeStoryPath } from './story/route-story';
import { useScrubScrollEnabled } from './use-scrub-scroll-lock';

export const routeDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;
export const routePath = (id: string) => `/routes/${encodeURIComponent(id)}`;

/**
/**
 * Действия карточки (routes-04d, RC-11): «Поделиться» (primary; route-story-card, R7: вошедшему со ссылкой — шит
 * «Карточка для сторис / Ссылка», гостю — сразу ссылка (share sheet / Web Share / копирование с «Ссылка
 * скопирована»; с OG-картинкой файлом, когда она готова и платформа умеет), без origin вошедшему — сразу экран
 * карточки; нечем делиться — кнопки нет, появляется после монтирования) и скачивание (secondary; web скачивает в той
 * же вкладке, native открывает системный браузер; адрес не логируется) — в одну строку поровну, одна кнопка — во всю
 * ширину. Скачивание (routes-formats, RC-8, RC-9): только GPX — прежняя «Скачать GPX»; несколько форматов —
 * «Скачать» → шит выбора (`RouteDownloadSheet`, после монтирования). Уведомления — во всю ширину под строкой; отказ
 * скачивания — с форматом.
 */
function RouteActions({
  route,
  mounted,
  signedIn,
}: {
  route: CatalogRouteDetail;
  mounted: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [failedFormat, setFailedFormat] = useState<RouteExportFormat | null>(null);
  const [picking, setPicking] = useState(false);
  const canLink = mounted && shareOrigin() !== null;
  // маршрут на экране — уже каталог; остальное (снят, скрыт) решает сервер — 404 на экране карточки
  const canCard = signedIn && mounted;
  // OG-картинка файлом — заранее; не готова — делимся ссылкой
  const image = useShareImage('route', route.id, canLink);
  const share = useShareChoice({
    title: t('share.choice.title'),
    cardLabel: t('routeCard.open'),
    onCard: canCard ? () => router.push(routeStoryPath(route.id)) : null,
    link: canLink
      ? {
          title: route.title,
          text: routeShareDescription(route),
          path: routePath(route.id),
          image,
        }
      : null,
  });
  const formats = availableExportFormats(route);
  if (!share.available && formats.length === 0) return null;
  const onlyGpx = formats.length === 1 && formats[0] === 'gpx';
  const download = (format: RouteExportFormat) => {
    setFailedFormat(null);
    // синхронно в обработчике нажатия (web: клик по ссылке до любого await)
    downloadFile(api.catalogRouteExportUrl(route.id, format)).catch(() => setFailedFormat(format));
  };
  const pick = (format: RouteExportFormat) => {
    download(format);
    setPicking(false);
  };
  return (
    <View style={styles.stack}>
      <View testID="route-actions" style={styles.actions}>
        {share.available ? (
          <View style={styles.action}>
            <Button label={t('routes.detail.share')} variant="primary" onPress={share.press} />
          </View>
        ) : null}
        {onlyGpx ? (
          <View style={styles.action}>
            <Button
              label={t('routes.detail.gpx')}
              variant="secondary"
              onPress={() => download('gpx')}
            />
          </View>
        ) : null}
        {formats.length > 0 && !onlyGpx ? (
          <View style={styles.action}>
            <Button
              label={t('routes.detail.download')}
              variant="secondary"
              onPress={() => setPicking(true)}
            />
          </View>
        ) : null}
      </View>
      {share.notice}
      {failedFormat !== null ? (
        <Banner
          tone="warning"
          message={t('routes.detail.downloadFailed', {
            format: t(`routes.detail.format.${failedFormat}`),
          })}
        />
      ) : null}
      {share.sheet}
      {mounted && picking ? (
        <RouteDownloadSheet formats={formats} onPick={pick} onClose={() => setPicking(false)} />
      ) : null}
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

/**
 * «Пожаловаться» на маршрут райдера (routes-06, A4): только вошедшему и только по `viewer.canReport` сервера (свой и
 * команды — нет); уже жаловался — «Вы пожаловались на этот маршрут». Загрузка, ошибка с повтором и баннер ошибки
 * обновления — `AsyncContent` (AGENTS.md §4.12). Гостю и маршруту команды (`viewer` нет) — ничего.
 */
function RouteReportAction({
  id,
  viewer,
}: {
  id: string;
  viewer: ReturnType<typeof useCatalogRouteViewer>;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <AsyncContent
      query={viewer}
      skeleton={
        <View testID="route-report-skeleton">
          <SkeletonText variant="body" lines={1} lastLineWidth="40%" />
        </View>
      }
    >
      {(data) =>
        data.reported ? (
          <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
            {t('routes.report.reported')}
          </Text>
        ) : data.canReport ? (
          <View style={styles.start}>
            <TextAction
              label={t('routes.report.action')}
              onPress={() => router.push(`/routes/report/${encodeURIComponent(id)}`)}
            />
          </View>
        ) : null
      }
    </AsyncContent>
  );
}

/**
 * Шапка шторки (routes-04d, L3): строка цифр — видна и в свёрнутой шторке; у тем — плитки или крупная дистанция
 * (высоту шапки шторка измеряет сама, отступ камеры следует).
 */
function RouteSheetHeader({ route }: { route: CatalogRouteDetail }) {
  const variant = ROUTE_STATS_VARIANT[useAppTheme().layout.routeStats];
  return (
    <View style={styles.sheetHeader}>
      <StatBlock variant={variant} items={routeStatItems(route)} />
    </View>
  );
}

/**
 * Тело шторки карточки маршрута (routes-03, P1; routes-04d, L3): без названия (оно в шапке экрана), бейдж автора
 * маршрута райдера (routes-06), чипы (покрытия, форма, город; `'unknown'` — без чипа), профиль высоты без заголовка
 * со скраббингом, действия в строку, «Пожаловаться» (маршрут райдера), «Мои заезды» (вошедшему, route-rides-02),
 * «Другие на маршруте» (вошедшему, route-rides-04), «Гонки на маршруте».
 */
function RouteSheetBody({
  route,
  races,
  viewer,
  rides,
  others,
  now,
  mounted,
  signedIn,
  scrub,
}: {
  route: CatalogRouteDetail;
  races: ReturnType<typeof useCatalogRouteRaces>;
  /** запрос права жалобы — только вошедшему на маршруте райдера; иначе `null` (блока нет) */
  viewer: ReturnType<typeof useCatalogRouteViewer> | null;
  /** «Мои заезды» (route-rides-02) — только вошедшему на клиенте; иначе `null` (блока нет) */
  rides: ReturnType<typeof useRouteRides> | null;
  /** «Другие на маршруте» (route-rides-04) — только вошедшему на клиенте; иначе `null` (блока нет) */
  others: ReturnType<typeof useRouteRideLeaderboard> | null;
  now: Date | null;
  mounted: boolean;
  signedIn: boolean;
  scrub: ScrubStore;
}) {
  const author = routeAuthorLabel(route);
  return (
    <View style={styles.detail}>
      {author ? (
        <View style={styles.start}>
          <Pill label={author} tone="accent" />
        </View>
      ) : null}
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
      <RouteActions route={route} mounted={mounted} signedIn={signedIn} />
      {viewer ? <RouteReportAction id={route.id} viewer={viewer} /> : null}
      <RouteRidesBlock routeId={route.id} mine={false} rides={rides} now={now} />
      <RouteRideOthersBlock routeId={route.id} board={others} now={now} />
      <RouteRaces races={races} now={now} />
    </View>
  );
}

/**
 * Лучший свой заезд сменился (опрос «Моих заездов» на карточке довёл проверку до финала без экрана результата) — своя
 * строка таблицы «Другие» устарела (route-rides-04, RC-B6). `bestId`: `undefined` — список не загружен, `null` — лучшего
 * нет (или 404); смена — `null → id`, `id → null`, `id → id'`; первая загрузка (`undefined → …`) — не смена.
 */
function useBestRideChange(routeId: string, bestId: string | null | undefined) {
  const queryClient = useQueryClient();
  const previous = useRef(bestId);
  useEffect(() => {
    const was = previous.current;
    previous.current = bestId;
    if (was !== undefined && bestId !== undefined && bestId !== was) {
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.leaderboardAll(routeId) });
    }
  }, [bestId, queryClient, routeId]);
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
  const variant = ROUTE_STATS_VARIANT[useAppTheme().layout.routeStats];
  const block = { backgroundColor: theme.surface.skeleton };
  return (
    <View testID="route-detail-skeleton" style={styles.area}>
      <View style={[StyleSheet.absoluteFill, block]} />
      <View style={[sheetStyles.sheet, sheetSurface(theme)]}>
        <View style={sheetStyles.grabber} />
        <View style={[styles.sheetHeader, styles.skeletonSheet]}>
          <SkeletonGroup>
            <StatBlockSkeleton variant={variant} />
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
  const authorKind = route.data?.author.kind;
  // гонки маршрута — только клиент (в SSR не попадают); маршрут райдера в гонке не бывает — не запрашиваем (RC-1)
  const races = useCatalogRouteRaces(id, valid && authorKind === 'team');
  // routes-06: «Пожаловаться» — только вошедшему на карточке маршрута райдера (клиентский запрос, не SSR)
  const viewerEnabled = valid && signedIn && authorKind === 'rider';
  const viewer = useCatalogRouteViewer(id, viewerEnabled);
  const hasRoute = route.data !== undefined;
  // route-rides-02: «Мои заезды» — только вошедшему и только клиент (SSR: сессия `unknown`), после карточки
  const ridesEnabled = valid && signedIn && hasRoute;
  const rides = useRouteRides(id, ridesEnabled);
  // route-rides-04: «Другие на маршруте» — те же условия, что у «Моих заездов»
  const others = useRouteRideLeaderboard(id, OTHERS_CARD_ROWS, ridesEnabled);
  useBestRideChange(
    id,
    rides.data === undefined ? undefined : (rides.data?.summary.best?.id ?? null),
  );
  const now = useMinskClockAfterMount([
    route.dataUpdatedAt,
    races.dataUpdatedAt,
    rides.dataUpdatedAt,
    others.dataUpdatedAt,
  ]);
  const refetchers = useMemo(
    () => [
      route.refetch,
      ...(hasRoute && authorKind === 'team' ? [races.refetch] : []),
      ...(hasRoute && signedIn && authorKind === 'rider' ? [viewer.refetch] : []),
      ...(hasRoute && signedIn ? [rides.refetch, others.refetch] : []),
    ],
    [
      route.refetch,
      hasRoute,
      authorKind,
      signedIn,
      races.refetch,
      viewer.refetch,
      rides.refetch,
      others.refetch,
    ],
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
                    viewer={viewerEnabled ? viewer : null}
                    rides={ridesEnabled ? rides : null}
                    others={ridesEnabled ? others : null}
                    now={now}
                    mounted={mounted}
                    signedIn={signedIn}
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
  start: { alignItems: 'flex-start' },
});
