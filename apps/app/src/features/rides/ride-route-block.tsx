import type { RideRoute } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { apiErrorOf } from '@pokatim/api-client';
import {
  PROFILE_ASPECT_RATIO,
  ROUTE_CATALOG_LINE_WIDTH,
  type ScrubStore,
} from '@pokatim/route-view';
import { AsyncContent, Banner, TextAction, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ElevationProfile } from '@/features/routes/elevation-profile';
import { routeKm } from '@/features/routes/format';
import { myRouteMapOptions } from '@/features/routes/my-routes-queries';
import { catalogRouteMapOptions, useCatalogRoute } from '@/features/routes/queries';
import { RouteLineMap } from '@/features/routes/route-line-map';

/** Путь карточки маршрута райда: публичный — каталог, свой непубличный — «Мои маршруты». */
export const rideRoutePath = (route: Pick<RideRoute, 'id' | 'access'>) =>
  route.access === 'private'
    ? `/routes/mine/${encodeURIComponent(route.id)}`
    : `/routes/${encodeURIComponent(route.id)}`;

/**
 * Маршрут на карточке райда (05c) — сразу под шапкой. Сервер отдаёт `route` только видимым зрителю. Публичный:
 * карта линии каталога (3:2 в прокрутке, как карта гонки) с маркером скраббинга и профиль высоты (общий `scrub` экрана)
 * — данные карточки каталога `GET /v1/routes/:id`, геометрия `/:id/map`. Свой непубличный (только организатору):
 * карта «Моего маршрута» без профиля (RC-9) и баннер «опубликуйте». Нет env карты, нативного модуля или геометрии —
 * карты нет (правила `RouteLineMap`); цифры карточки остаются. Строка «Маршрут райда» — на карточку маршрута.
 */
export function RideRouteBlock({ route, scrub }: { route: RideRoute; scrub: ScrubStore }) {
  const router = useRouter();
  const theme = useTheme();
  const isPublic = route.access === 'public';
  const detail = useCatalogRoute(route.id, undefined, isPublic);
  const elevation = detail.data?.elevation ?? null;
  // профиль — данные карточки каталога: загрузка — место профиля, ошибка — с повтором, ошибка обновления — профиль и
  // баннер (`AsyncContent`, ревью pass 1); 404 (снят между запросами) — без блока профиля
  const profileGone = !detail.data && apiErrorOf(detail.error)?.code === 'NOT_FOUND';
  if (route.access !== 'public' && route.access !== 'private') return null;
  const label = t('rides.detail.routeMap', {
    title: route.title,
    distance: routeKm(route.distanceM),
  });
  return (
    <View testID="ride-route" style={styles.block}>
      {isPublic ? (
        <RouteLineMap
          mapQuery={catalogRouteMapOptions(route.id)}
          lineWidth={ROUTE_CATALOG_LINE_WIDTH}
          scrub={elevation ? scrub : undefined}
          accessibilityLabel={label}
          failedMessage={t('routes.detail.map.failed')}
          skeletonTestID="ride-route-map-skeleton"
        />
      ) : (
        <>
          <RouteLineMap
            mapQuery={myRouteMapOptions(route.id)}
            lineWidth={ROUTE_CATALOG_LINE_WIDTH}
            accessibilityLabel={label}
            failedMessage={t('routes.detail.map.failed')}
            skeletonTestID="ride-route-map-skeleton"
          />
          <Banner message={t('rides.detail.routePrivate')} />
        </>
      )}
      {isPublic && !profileGone ? (
        <AsyncContent
          query={detail}
          skeleton={
            <View
              testID="ride-route-profile-skeleton"
              style={[styles.profilePlace, { backgroundColor: theme.surface.skeleton }]}
            />
          }
        >
          {(data) =>
            data.elevation ? (
              <ElevationProfile
                elevation={data.elevation}
                distanceM={data.distanceM}
                gainM={data.elevationGainM}
                scrub={scrub}
              />
            ) : null
          }
        </AsyncContent>
      ) : null}
      <View style={styles.start}>
        <TextAction
          label={t('rides.detail.routeLink')}
          onPress={() => router.push(rideRoutePath(route))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
  profilePlace: { width: '100%', aspectRatio: PROFILE_ASPECT_RATIO },
});
