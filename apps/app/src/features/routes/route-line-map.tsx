import type { RouteMapGeometry } from '@pokatim/contracts';
import { apiErrorOf } from '@pokatim/api-client';
import { AsyncContent, SkeletonGroup } from '@rkarakulov/ui';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { MAP_ASPECT_RATIO } from '@/features/maps/corridor-style';
import { RouteMap } from '@/features/maps/route-map';
import type { ScrubStore } from '@/features/maps/scrub-store';
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
  /** толщина линии маршрута, px (routes-03: каталог — `ROUTE_CATALOG_LINE_WIDTH`); по умолчанию — как у карты гонки */
  lineWidth?: number;
  /** routes-04: стор скраббинга экрана — маркер на линии, связанный с профилем; нет — без маркера */
  scrub?: ScrubStore;
}

/**
 * Карта линии маршрута без коридора (routes-01 RC-5/RC-16, routes-02 RC-15): линия, старт и финиш. SSR и первый
 * клиентский рендер — место карты (скелетон той же пропорции): env стиля и геометрия известны только после
 * монтирования. Env не задан или нативного модуля нет — блока нет (цифры карточки остаются); геометрии нет (404) —
 * тоже. Остальное — `AsyncContent` (§4.12): загрузка — скелетон, ошибка без данных — «Нет соединения» / «Не удалось
 * загрузить» с повтором (`geometry.refetch`), ошибка обновления при показанной карте — карта и баннер.
 */
export function RouteLineMap({
  mapQuery,
  accessibilityLabel,
  failedMessage,
  skeletonTestID,
  lineWidth,
  scrub,
}: RouteLineMapProps) {
  const { mounted, styleUrl, theme } = useMapStyle();
  const geometry = useQuery({ ...mapQuery, enabled: styleUrl !== null });

  const skeleton = (
    <SkeletonGroup>
      <View
        testID={skeletonTestID}
        style={[styles.place, { backgroundColor: theme.surface.skeleton }]}
      />
    </SkeletonGroup>
  );
  if (mounted && styleUrl === null) return null;
  if (styleUrl === null) return skeleton;
  if (!geometry.data && apiErrorOf(geometry.error)?.code === 'NOT_FOUND') return null;
  return (
    <AsyncContent query={geometry} skeleton={skeleton}>
      {(data) => (
        <LineMap
          geometry={data}
          styleUrl={styleUrl}
          theme={theme}
          accessibilityLabel={accessibilityLabel}
          failedMessage={failedMessage}
          lineWidth={lineWidth}
          scrub={scrub}
        />
      )}
    </AsyncContent>
  );
}

function LineMap({
  geometry,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
  lineWidth,
  scrub,
}: {
  geometry: RouteMapGeometry;
  styleUrl: string;
  theme: ReturnType<typeof useMapStyle>['theme'];
  accessibilityLabel: string;
  failedMessage: string;
  lineWidth: number | undefined;
  scrub: ScrubStore | undefined;
}) {
  const map = useMemo(() => withoutCorridor(geometry), [geometry]);
  return (
    <RouteMap
      // смена стиля (темы) — новая карта: сброс ошибки прошлого стиля; native-камера применяет рамку один раз
      key={`${styleUrl}|${map.bounds.join(',')}`}
      map={map}
      corridor={false}
      lineWidth={lineWidth}
      scrub={scrub}
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
