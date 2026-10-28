import { CITY_CENTERS, type RideMap } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Banner, EmptyState, TextAction, useTheme } from '@rkarakulov/ui';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMapStyle } from '@/features/maps/use-map-style';
import { useMinskClock } from '@/lib/use-minsk-clock';

import type { RideFilters } from './filters';
import type { NearQuery } from './near';
import type { useRideMap } from './queries';
import { RidePointsMap } from './ride-points-map';
import { pointsBounds } from './ride-points-style';

/** Карта и строка «Ещё N райдов без точки старта» по данным. */
function PointsMap({
  data,
  filters,
  near,
  styleUrl,
  now,
  onOpen,
  onList,
}: {
  data: RideMap;
  now: Date;
  filters: RideFilters;
  near: NearQuery | null;
  styleUrl: string;
  onOpen: (rideId: string) => void;
  onList: () => void;
}) {
  const { theme } = useMapStyle();
  const me = near?.lngLat ?? null;
  const fallback = CITY_CENTERS[filters.city[0] ?? 'minsk'];
  // рамка — один массив на данные: карта пересоздаётся только при новых точках, позиции или городе
  const bounds = useMemo(() => pointsBounds(data.items, me, fallback), [data.items, me, fallback]);
  const without =
    data.withoutStart > 0 ? (
      <View style={styles.without}>
        <TextAction
          label={t('rides.map.withoutStart', { count: data.withoutStart })}
          onPress={onList}
        />
      </View>
    ) : null;
  if (data.items.length === 0) {
    return (
      <View style={styles.gutter}>
        <EmptyState
          title={t('rides.map.empty')}
          message={t('rides.map.emptyMessage')}
          action={{ label: t('rides.view.list'), onPress: onList }}
        />
        {without}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      {without ? <View style={styles.gutter}>{without}</View> : null}
      <RidePointsMap
        // смена темы — новая карта (native-камера применяет рамку один раз)
        key={`${styleUrl}|${bounds.join(',')}`}
        points={data.items}
        me={me}
        bounds={bounds}
        styleUrl={styleUrl}
        theme={theme}
        accessibilityLabel={t('rides.map.label', { count: data.items.length })}
        failedMessage={t('rides.map.failed')}
        now={now}
        onOpen={onOpen}
      />
    </View>
  );
}

/**
 * Режим «Карта» ленты райдов (05c): точки старта будущих райдов с видимым маршрутом в том же фильтре (город,
 * «Рядом»). Запрос — только в этом режиме (`useRideMap` в ленте). Карта недоступна (env, нет нативного модуля) — сообщение и «Список»;
 * загрузка — место карты; ошибка — `AsyncContent` с повтором; точек нет — `EmptyState` и путь в «Список».
 */
export function RideMapView({
  map,
  pending,
  filters,
  near,
  onOpen,
  onList,
}: {
  /** запрос карты (`useRideMap` ленты — офлайн-баннер шапки от него же) */
  map: ReturnType<typeof useRideMap>;
  /** «Рядом» читает позицию — место карты, без точек */
  pending: boolean;
  filters: RideFilters;
  near: NearQuery | null;
  onOpen: (rideId: string) => void;
  onList: () => void;
}) {
  const theme = useTheme();
  const { mounted, styleUrl } = useMapStyle();
  const now = useMinskClock([map.dataUpdatedAt]);
  if (mounted && styleUrl === null) {
    return (
      <View style={styles.gutter}>
        <EmptyState
          title={t('rides.map.failed')}
          action={{ label: t('rides.view.list'), onPress: onList }}
        />
      </View>
    );
  }
  // место карты на всю область — без `SkeletonGroup` (его обёртка не растягивается), подпись «Загрузка» — у самого
  // места (как `RouteLineMap` в режиме `fill`, ревью pass 2)
  const place = (
    <View
      testID="ride-map-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('state.loading')}
      style={[styles.place, { backgroundColor: theme.surface.skeleton }]}
    />
  );
  if (styleUrl === null || pending) return place;
  if (map.data !== undefined) {
    // данные есть: карта — в постоянном контейнере `flex: 1`; ошибка обновления — баннер с повтором соседним блоком
    // (stale-обёртка `AsyncContent` без flex схлопнула бы карту)
    return (
      <View testID="ride-map-area" style={styles.fill}>
        {map.isError ? (
          <View style={[styles.gutter, styles.stale]}>
            <Banner
              tone="warning"
              title={t('state.staleTitle')}
              message={t('state.staleMessage')}
            />
            <View style={styles.start}>
              <TextAction label={t('state.retry')} onPress={() => void map.refetch()} />
            </View>
          </View>
        ) : null}
        <PointsMap
          data={map.data}
          filters={filters}
          near={near}
          styleUrl={styleUrl}
          now={now}
          onOpen={onOpen}
          onList={onList}
        />
      </View>
    );
  }
  if (map.isPending && map.fetchStatus !== 'paused') return place;
  // ошибка без данных, офлайн-старт — состояния `AsyncContent` с повтором
  return (
    <View style={styles.gutter}>
      <AsyncContent query={map} skeleton={null}>
        {() => null}
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gutter: { paddingHorizontal: size.gutter },
  without: { alignItems: 'flex-start', paddingBottom: space.s2 },
  place: { flex: 1, minHeight: size.touchMin * 4 },
  stale: { gap: space.s2, paddingBottom: space.s2 },
  start: { alignItems: 'flex-start' },
});
