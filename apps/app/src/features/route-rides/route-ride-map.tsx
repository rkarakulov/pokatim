import type { RouteRideDetail } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { MAP_ASPECT_RATIO, ROUTE_CATALOG_LINE_WIDTH } from '@pokatim/route-view';
import { SkeletonGroup, TextAction, textStyle } from '@rkarakulov/ui';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RouteMapTrack } from '@/features/maps/track-style';
import { useMapStyle } from '@/features/maps/use-map-style';
import { myTrackMapLabel } from '@/features/races/my-track-format';
import { routeKm } from '@/features/routes/format';
import { myRouteMapOptions } from '@/features/routes/my-routes-queries';
import { catalogRouteMapOptions } from '@/features/routes/queries';
import { RouteLineMap } from '@/features/routes/route-line-map';

import { useRouteRideTrack } from './queries';
import { routeRideTrackLines } from './route-ride-format';

/**
 * Карта маршрута со своим треком заезда (route-rides-02, A4): общий `RouteLineMap` (геометрия и кэш — как у карточки:
 * каталог или свой маршрут) + трек `/track` (сегмент, сход пунктиром). Пока трек грузится впервые — скелетон места
 * карты (карта не монтируется дважды); ошибка трека без данных — строка с повтором и карта без трека; 404 трека —
 * карта без трека и без строки. Нет env, модуля, геометрии — `RouteLineMap` схлопывается, текстовая альтернатива
 * остаётся.
 */
export function RouteRideMap({
  routeId,
  ride,
  mine,
}: {
  routeId: string;
  ride: RouteRideDetail;
  mine: boolean;
}) {
  const { styleUrl, theme } = useMapStyle();
  const trackQuery = useRouteRideTrack(routeId, ride, styleUrl !== null);
  const data = trackQuery.data ?? null;
  const track = useMemo<RouteMapTrack | undefined>(
    () => (data ? { line: data.line, segment: data.segment, offRuns: data.offRuns } : undefined),
    [data],
  );
  const trackPending =
    trackQuery.isLoading && trackQuery.failureCount === 0 && trackQuery.errorUpdateCount === 0;

  const base = mine
    ? t('routes.mine.detail.map.label', { distance: routeKm(ride.route.distanceM) })
    : t('routes.detail.map.label', { distance: routeKm(ride.route.distanceM) });
  const lines = data ? routeRideTrackLines(ride, data.marks, data.offRuns.length) : [];
  const secondary = [textStyle('meta'), { color: theme.text.secondary }];
  return (
    <View style={styles.block}>
      {trackPending ? (
        <SkeletonGroup>
          <View
            testID="route-ride-map-skeleton"
            style={[styles.place, { backgroundColor: theme.surface.skeleton }]}
          />
        </SkeletonGroup>
      ) : (
        <RouteLineMap
          // новая ревизия проверки — новая карта (native-камера применяет рамку один раз)
          key={`${ride.id}|${ride.status}|${ride.checkedAt ?? ''}`}
          mapQuery={mine ? myRouteMapOptions(routeId) : catalogRouteMapOptions(routeId)}
          lineWidth={mine ? undefined : ROUTE_CATALOG_LINE_WIDTH}
          track={track}
          accessibilityLabel={lines.length > 0 ? myTrackMapLabel(base, lines) : base}
          failedMessage={mine ? t('routes.mine.detail.map.failed') : t('routes.detail.map.failed')}
          skeletonTestID="route-ride-map-skeleton"
        />
      )}
      {track && data ? (
        <Text style={secondary}>
          {data.marks === 'ready' && data.offRuns.length > 0
            ? `${t('races.detail.myTrack.legendTrack')} · ${t('races.detail.myTrack.legendOff')}`
            : t('races.detail.myTrack.legendTrack')}
        </Text>
      ) : null}
      {lines.map((line) => (
        <Text key={line} style={[textStyle('body'), { color: theme.text.primary }]}>
          {line}
        </Text>
      ))}
      {trackQuery.isError && !data ? (
        <View testID="route-ride-track-error" style={styles.error}>
          <Text style={secondary}>{t('races.detail.myTrack.failed')}</Text>
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void trackQuery.refetch()} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
  block: { gap: space.s2 },
  error: { gap: space.s1 },
  start: { alignItems: 'flex-start' },
});
