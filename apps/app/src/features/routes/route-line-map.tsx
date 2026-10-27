import type { RouteMapGeometry } from '@pokatim/contracts';
import { SkeletonGroup } from '@rkarakulov/ui';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { MAP_ASPECT_RATIO } from '@/features/maps/corridor-style';
import { RouteMap } from '@/features/maps/route-map';
import { withoutCorridor } from '@/features/maps/route-geometry';
import { useMapStyle } from '@/features/maps/use-map-style';

export interface RouteLineMapProps {
  /** запрос геометрии (`queryOptions`): каталог — публичный, мой маршрут — с входом */
  mapQuery: UseQueryOptions<RouteMapGeometry, Error, RouteMapGeometry, readonly unknown[]>;
  /** текстовая альтернатива без координат */
  accessibilityLabel: string;
  failedMessage: string;
  /** testID места карты до данных */
  skeletonTestID: string;
}

/**
 * Карта линии маршрута без коридора (routes-01 RC-5/RC-16, routes-02 RC-15): линия, старт и финиш. SSR и первый
 * клиентский рендер — место карты (скелетон той же пропорции): env стиля и геометрия известны только после
 * монтирования. Затем: env не задан, нативного модуля нет, геометрия 404 или ошибка без данных — блока нет (цифры
 * карточки остаются); иначе — карта по теме приложения. Запрос геометрии — только когда стиль карты задан.
 */
export function RouteLineMap({
  mapQuery,
  accessibilityLabel,
  failedMessage,
  skeletonTestID,
}: RouteLineMapProps) {
  const { mounted, styleUrl, theme } = useMapStyle();
  const geometry = useQuery({ ...mapQuery, enabled: styleUrl !== null });
  const map = useMemo(
    () => (geometry.data ? withoutCorridor(geometry.data) : null),
    [geometry.data],
  );

  if (mounted && (styleUrl === null || (geometry.isError && !geometry.data))) return null;
  if (!map || styleUrl === null) {
    return (
      <SkeletonGroup>
        <View
          testID={skeletonTestID}
          style={[styles.place, { backgroundColor: theme.surface.skeleton }]}
        />
      </SkeletonGroup>
    );
  }
  return (
    <RouteMap
      // смена стиля (темы) — новая карта: сброс ошибки прошлого стиля; native-камера применяет рамку один раз
      key={`${styleUrl}|${map.bounds.join(',')}`}
      map={map}
      corridor={false}
      styleUrl={styleUrl}
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failedMessage}
    />
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
});
