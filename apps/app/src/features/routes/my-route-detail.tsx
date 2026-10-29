import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type MyRoute } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { i18n, t } from '@pokatim/i18n';
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
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { actionErrorMessage, apiErrorCode } from '@/features/auth/error-messages';
import { useRouteRides } from '@/features/route-rides/queries';
import { RouteRidesBlock } from '@/features/route-rides/route-rides-block';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { DetailRow } from './detail-row';
import { routePublicationErrorMessage } from './error-messages';
import { routeKm } from './format';
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

/**
 * Поля своего маршрута (M4): название, готовый — карта без коридора и строки «Длина», «Набор», «Петля», «Загружен»;
 * «Обрабатывается» и отказ — статус вместо карты. «Мои заезды» у готового (route-rides-02). «Переименовать», «Удалить».
 * Без «Поделиться» и OG (M3).
 */
function MyRouteView({
  route,
  rides,
  now,
}: {
  route: MyRoute;
  /** «Мои заезды» (route-rides-02) — только у готового маршрута */
  rides: ReturnType<typeof useRouteRides>;
  now: Date;
}) {
  const theme = useTheme();
  const [renaming, setRenaming] = useState(false);
  const status = myRouteStatus(route);
  const ready = route.status === 'ready' && route.distanceM !== null;
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
      {ready && route.distanceM !== null ? (
        <>
          <RouteLineMap
            mapQuery={myRouteMapOptions(route.id)}
            accessibilityLabel={t('routes.mine.detail.map.label', {
              distance: routeKm(route.distanceM),
            })}
            failedMessage={t('routes.mine.detail.map.failed')}
            skeletonTestID="my-route-map-skeleton"
          />
          <DetailRow label={t('routes.detail.length')}>{routeKm(route.distanceM)}</DetailRow>
          {route.elevationGainM !== null ? (
            <DetailRow label={t('routes.detail.elevation')}>
              {t('routes.detail.elevationValue', { gain: i18n.formatNumber(route.elevationGainM) })}
            </DetailRow>
          ) : null}
          <DetailRow label={t('routes.detail.loop')}>
            {route.isLoop ? t('routes.detail.yes') : t('routes.detail.no')}
          </DetailRow>
        </>
      ) : null}
      <DetailRow label={t('routes.mine.detail.uploadedAt')}>{myRouteUploadedAt(route)}</DetailRow>
      {route.status === 'ready' ? (
        <RouteRidesBlock routeId={route.id} mine rides={rides} now={now} />
      ) : null}
      <MyRoutePublication route={route} />
      {/* routes-06 (A3): на проверке и в каталоге название заморожено */}
      {myRouteRenameFrozen(route) ? (
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t('routes.publication.renameFrozen')}
        </Text>
      ) : renaming ? (
        <RenameForm route={route} onDone={() => setRenaming(false)} />
      ) : (
        <View style={styles.action}>
          <TextAction label={t('routes.mine.detail.rename')} onPress={() => setRenaming(true)} />
        </View>
      )}
      <DeleteAction route={route} />
    </View>
  );
}

/**
 * Карточка своего маршрута (`/routes/mine/<id>`, routes-02) — защищённый экран (гость — гард на вход, RC-11), без
 * `loader`, мета и OG. Невалидный id — «Маршрут недоступен» без запроса; 404 (чужой, удалён, неизвестен — неотличимы)
 * — то же + «Мои маршруты»; сеть и сервер — `AsyncContent`. Опрос, пока «Обрабатывается»; pull-to-refresh.
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
      <ScrollView
        testID="my-route-detail"
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
            title={t('routes.mine.detail.notFound')}
            action={{
              label: t('routes.mine.detail.back'),
              onPress: () => router.navigate(MY_ROUTES_HREF),
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
            {(data) => <MyRouteView route={data} rides={rides} now={now} />}
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
  stack: { gap: space.s3 },
  action: { alignItems: 'flex-start' },
});
