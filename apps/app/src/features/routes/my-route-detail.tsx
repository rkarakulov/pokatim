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
import { actionErrorMessage } from '@/features/auth/error-messages';
import { MapGestureLockContext, useMapGestureLock } from '@/features/maps/map-gesture-lock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { DetailRow } from './detail-row';
import { routeKm } from './format';
import { myRouteStatus, myRouteUploadedAt, routeTitleError } from './my-route-format';
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
          message={actionErrorMessage(rename.error)}
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
 * «Обрабатывается» и отказ — статус вместо карты. «Переименовать», «Удалить». Без «Поделиться» и OG (M3).
 */
function MyRouteView({ route }: { route: MyRoute }) {
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
      {renaming ? (
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
  // pull-to-refresh — и карточка, и карта (повтор после ошибки геометрии)
  const refetchers = useMemo(
    () => [
      route.refetch,
      () => queryClient.refetchQueries({ queryKey: myRoutesKeys.map(id), type: 'active' }),
    ],
    [route.refetch, queryClient, id],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  // 404 и при показанных данных (удалён на другом устройстве): «Маршрут недоступен», кеш карты — прочь
  const gone = apiErrorOf(route.error)?.code === 'NOT_FOUND';
  const notFound = !valid || gone;
  useEffect(() => {
    if (gone) queryClient.removeQueries({ queryKey: myRoutesKeys.map(id) });
  }, [gone, queryClient, id]);
  // routes-04b (RC-3): жест карты двумя пальцами (native) — экран не прокручивается; web контекст не вызывает
  const [scrollEnabled, onMapGesture] = useMapGestureLock();

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
      <MapGestureLockContext value={onMapGesture}>
        <ScrollView
          testID="my-route-detail"
          contentContainerStyle={styles.content}
          scrollEnabled={scrollEnabled}
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
              {(data) => <MyRouteView route={data} />}
            </AsyncContent>
          )}
        </ScrollView>
      </MapGestureLockContext>
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
