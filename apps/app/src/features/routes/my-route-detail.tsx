import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type MyRoute } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  Pill,
  SkeletonHeroCard,
  SkeletonText,
  TextAction,
  TextField,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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
import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { KeyboardAvoidingArea } from '@/components/keyboard-avoiding-area';
import { OfflineBanner } from '@/components/offline-banner';
import { StatBlock } from '@/components/stat-block';
import { actionErrorMessage, apiErrorCode } from '@/features/auth/error-messages';
import { useRouteRides } from '@/features/route-rides/queries';
import { RouteRidesBlock } from '@/features/route-rides/route-rides-block';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { useAppTheme } from '@/theme/use-app-theme';

import { DetailRow } from './detail-row';
import { routePublicationErrorMessage } from './error-messages';
import { ROUTE_STATS_VARIANT, routeDistanceGainItems, routeKm } from './format';
import {
  myRouteRenameFrozen,
  myRouteStatus,
  myRouteUploadedAt,
  routeTitleError,
} from './my-route-format';
import { MyRoutePublication } from './my-route-publication';
import {
  myRouteMapOptions,
  myRoutesKeys,
  useDeleteMyRoute,
  useMyRoute,
  useRenameMyRoute,
} from './my-routes-queries';
import { RouteLineMap } from './route-line-map';

/** «Мои маршруты» во вкладке: возврат после удаления и из «Маршрут недоступен». */
export const MY_ROUTES_HREF = '/routes?view=mine';

const documentTitle = (title: string) => `${title} — ${t('app.name')}`;

/** «Переименовать»: встроенная форма с ошибкой под полем (та же схема, что у сервера). */
function RenameForm({ route, onDone }: { route: MyRoute; onDone: () => void }) {
  const rename = useRenameMyRoute(route.id);
  const [title, setTitle] = useState(route.title);
  const [error, setError] = useState<string | undefined>();
  const save = () => {
    const invalid = routeTitleError(title);
    setError(invalid);
    if (invalid) return;
    rename.mutate(title.trim(), { onSuccess: onDone });
  };
  return (
    <View style={styles.stack}>
      <TextField
        label={t('routes.mine.title')}
        value={title}
        onChangeText={setTitle}
        error={error}
        autoCapitalize="sentences"
      />
      {rename.isError ? (
        <Banner
          tone="error"
          title={t('routes.mine.detail.renameFailed')}
          message={
            // routes-06 (N6): заявку подали на другом устройстве — «Заявка уже на проверке» / «уже в каталоге»
            apiErrorCode(rename.error) === 'ROUTE_INVALID_STATE'
              ? routePublicationErrorMessage(rename.error, 'routes.mine.detail.renameFailed')
              : actionErrorMessage(rename.error)
          }
        />
      ) : null}
      <Button
        label={t('routes.mine.detail.renameSave')}
        onPress={save}
        loading={rename.isPending}
      />
      <View style={styles.action}>
        <TextAction
          label={t('routes.mine.detail.renameCancel')}
          onPress={onDone}
          disabled={rename.isPending}
        />
      </View>
    </View>
  );
}

/**
 * «Удалить» с подтверждением (как `UploadRow`): после успеха — «Мои маршруты» (`dismissTo`: вкладка уже в стеке —
 * снять экраны над ней, нет (ссылка) — заменить; `replace` положил бы второй экземпляр вкладок).
 */
function DeleteAction({ route }: { route: MyRoute }) {
  const theme = useTheme();
  const router = useRouter();
  const remove = useDeleteMyRoute(route.id);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <View style={styles.action}>
        <TextAction
          label={t('routes.mine.detail.delete')}
          destructive
          onPress={() => setConfirming(true)}
        />
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {t('routes.mine.detail.deleteConfirm')}
      </Text>
      {/* routes-06 (U6): опубликованный маршрут уйдёт и из каталога */}
      {route.publication?.status === 'approved' ? (
        <Banner tone="warning" message={t('routes.publication.deleteWarning')} />
      ) : null}
      {remove.isError ? (
        <Banner
          tone="error"
          title={t('routes.mine.detail.deleteFailed')}
          message={actionErrorMessage(remove.error)}
        />
      ) : null}
      <Button
        label={t('routes.mine.detail.delete')}
        onPress={() =>
          remove.mutate(undefined, { onSuccess: () => router.dismissTo(MY_ROUTES_HREF) })
        }
        loading={remove.isPending}
      />
      <View style={styles.action}>
        <TextAction
          label={t('routes.mine.detail.deleteCancel')}
          onPress={() => {
            setConfirming(false);
            remove.reset();
          }}
          disabled={remove.isPending}
        />
      </View>
    </View>
  );
}

/** Готовый маршрут с длиной — карта и шторка (routes-07); иначе — прокрутка без карты. */
const isMapped = (route: MyRoute): route is MyRoute & { distanceM: number } =>
  route.status === 'ready' && route.distanceM !== null;

/**
 * «Переименовать» или подпись «название заморожено» (routes-06, A3: на проверке и в каталоге название не меняется).
 */
function RenameAction({ route, onRename }: { route: MyRoute; onRename: () => void }) {
  const theme = useTheme();
  if (myRouteRenameFrozen(route)) {
    return (
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('routes.publication.renameFrozen')}
      </Text>
    );
  }
  return (
    <View style={styles.action}>
      <TextAction label={t('routes.mine.detail.rename')} onPress={onRename} />
    </View>
  );
}

/**
 * Свой маршрут без карты (M4): «Обрабатывается», отказ или незнакомый статус — подпись «Мой маршрут», название,
 * статус, «Загружен», заявка в каталог, «Переименовать», «Удалить». Без «Поделиться» и OG (M3).
 */
function MyRouteView({ route }: { route: MyRoute }) {
  const theme = useTheme();
  const [renaming, setRenaming] = useState(false);
  const status = myRouteStatus(route);
  return (
    <View style={styles.detail}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('routes.mine.detail.kicker')}
      </Text>
      <Text style={[textStyle('displaySm'), { color: theme.text.primary }]}>{route.title}</Text>
      {status ? (
        <View style={styles.action}>
          <Pill label={status.label} tone={status.tone} />
        </View>
      ) : null}
      <DetailRow label={t('routes.mine.detail.uploadedAt')}>{myRouteUploadedAt(route)}</DetailRow>
      <MyRoutePublication route={route} />
      {renaming ? (
        <RenameForm route={route} onDone={() => setRenaming(false)} />
      ) : (
        <RenameAction route={route} onRename={() => setRenaming(true)} />
      )}
      <DeleteAction route={route} />
    </View>
  );
}

/** Шапка шторки (routes-07, как routes-04d L3): «Дистанция» и «Набор» по раскладке темы; видна и в свёрнутой. */
function MyRouteSheetHeader({ route }: { route: MyRoute & { distanceM: number } }) {
  const variant = ROUTE_STATS_VARIANT[useAppTheme().layout.routeStats];
  return (
    <View style={styles.sheetHeader}>
      <StatBlock
        variant={variant}
        items={routeDistanceGainItems({
          distanceM: route.distanceM,
          elevationGainM: route.elevationGainM,
          isLoop: route.isLoop === true,
        })}
      />
    </View>
  );
}

/**
 * Тело шторки (routes-07): без названия (оно в шапке экрана) — «Загружен», «Мои заезды» (route-rides-02), заявка в
 * каталог, «Переименовать», «Удалить». Переименование — тело целиком становится формой: поле вверху, над клавиатурой.
 */
function MyRouteSheetBody({
  route,
  rides,
  now,
  renaming,
  onRenamingChange,
}: {
  route: MyRoute;
  rides: ReturnType<typeof useRouteRides>;
  now: Date;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
}) {
  if (renaming) return <RenameForm route={route} onDone={() => onRenamingChange(false)} />;
  return (
    <View style={styles.detail}>
      <DetailRow label={t('routes.mine.detail.uploadedAt')}>{myRouteUploadedAt(route)}</DetailRow>
      <RouteRidesBlock routeId={route.id} mine rides={rides} now={now} />
      <MyRoutePublication route={route} />
      <RenameAction route={route} onRename={() => onRenamingChange(true)} />
      <DeleteAction route={route} />
    </View>
  );
}

/**
 * Готовый маршрут (routes-07, как карточка каталога routes-04d): карта на всю область под шапкой и шторка поверх
 * (состояние `expanded` — здесь, SSR — развёрнута; видимая высота шторки — отступ камеры, до измерения карта ждёт).
 * Тело шторки — прокрутка с pull-to-refresh; ошибка обновления — баннер `AsyncContent` над данными. Область — в
 * `KeyboardAvoidingArea`: при переименовании шторка поднимается над клавиатурой, касания «Сохранить» доходят.
 */
function MyRouteSheet({
  route,
  query,
  rides,
  now,
  refresh,
}: {
  route: MyRoute & { distanceM: number };
  query: ReturnType<typeof useMyRoute>;
  rides: ReturnType<typeof useRouteRides>;
  now: Date;
  refresh: ScrollViewProps['refreshControl'];
}) {
  const [expanded, setExpanded] = useState(true);
  const [sheetHeight, setSheetHeight] = useState<number | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  return (
    <KeyboardAvoidingArea testID="my-route-keyboard-area" style={styles.area}>
      <View style={StyleSheet.absoluteFill}>
        <RouteLineMap
          mapQuery={myRouteMapOptions(route.id)}
          accessibilityLabel={t('routes.mine.detail.map.label', {
            distance: routeKm(route.distanceM),
          })}
          failedMessage={t('routes.mine.detail.map.failed')}
          skeletonTestID="my-route-map-skeleton"
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
        header={<MyRouteSheetHeader route={route} />}
      >
        <ScrollView
          testID="my-route-detail"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={refresh}
        >
          <AsyncContent query={query} skeleton={null}>
            {(data) => (
              <MyRouteSheetBody
                route={data}
                rides={rides}
                now={now}
                renaming={renaming}
                onRenamingChange={setRenaming}
              />
            )}
          </AsyncContent>
        </ScrollView>
      </BottomSheet>
    </KeyboardAvoidingArea>
  );
}

/** Прокрутка без карты (404, загрузка, ошибка без данных, маршрут без карты) — с pull-to-refresh. */
function StateScroll({
  refresh,
  children,
}: {
  refresh: ScrollViewProps['refreshControl'];
  children: ReactNode;
}) {
  return (
    <ScrollView
      testID="my-route-detail"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={refresh}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Карточка своего маршрута (`/routes/mine/<id>`, routes-02) — защищённый экран (гость — гард на вход, RC-11), без
 * `loader`, мета и OG. Невалидный id — «Маршрут недоступен» без запроса; 404 (чужой, удалён, неизвестен — неотличимы)
 * — то же + «Мои маршруты»; сеть и сервер — `AsyncContent`. Опрос, пока «Обрабатывается»; pull-to-refresh. Готовый —
 * карта на всю область и шторка (routes-07), остальные статусы — прокрутка без карты.
 */
export function MyRouteDetailScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const route = useMyRoute(id, valid);
  const queryClient = useQueryClient();
  // route-rides-02: «Мои заезды» — только у готового маршрута
  const ready = valid && route.data?.status === 'ready';
  const rides = useRouteRides(id, ready);
  const now = useMinskClock([route.dataUpdatedAt, rides.dataUpdatedAt]);
  // pull-to-refresh — карточка, карта (повтор после ошибки геометрии) и «Мои заезды»
  const refetchers = useMemo(
    () => [
      route.refetch,
      () => queryClient.refetchQueries({ queryKey: myRoutesKeys.map(id), type: 'active' }),
      ...(ready ? [rides.refetch] : []),
    ],
    [route.refetch, queryClient, id, ready, rides.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  // 404 и при показанных данных (удалён на другом устройстве): «Маршрут недоступен», кеш карты — прочь
  const gone = apiErrorOf(route.error)?.code === 'NOT_FOUND';
  const notFound = !valid || gone;
  useEffect(() => {
    if (gone) queryClient.removeQueries({ queryKey: myRoutesKeys.map(id) });
  }, [gone, queryClient, id]);
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
        title={documentTitle(
          route.data && !notFound ? route.data.title : t('routes.mine.detail.title'),
        )}
      />
      <DetailHeader title={notFound ? undefined : route.data?.title} fallback={MY_ROUTES_HREF} />
      <OfflineBanner hasData={route.data !== undefined && !notFound} style={styles.offline} />
      {notFound ? (
        <StateScroll refresh={refresh}>
          <EmptyState
            title={t('routes.mine.detail.notFound')}
            action={{
              label: t('routes.mine.detail.back'),
              onPress: () => router.navigate(MY_ROUTES_HREF),
            }}
          />
        </StateScroll>
      ) : route.data !== undefined && isMapped(route.data) ? (
        <MyRouteSheet route={route.data} query={route} rides={rides} now={now} refresh={refresh} />
      ) : (
        <StateScroll refresh={refresh}>
          <AsyncContent
            query={route}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
              </View>
            }
          >
            {(data) => <MyRouteView route={data} />}
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
  detail: { gap: space.s4 },
  offline: { paddingHorizontal: size.gutter, paddingBottom: space.s3 },
  stack: { gap: space.s3 },
  action: { alignItems: 'flex-start' },
});
