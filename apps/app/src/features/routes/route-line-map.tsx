import type { RouteMapGeometry } from '@pokatim/contracts';
import { apiErrorOf } from '@pokatim/api-client';
import { MAP_ASPECT_RATIO, type ScrubStore, withoutCorridor } from '@pokatim/route-view';
import { AsyncContent, SkeletonGroup } from '@rkarakulov/ui';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { RouteMap } from '@/features/maps/route-map';
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
  /**
   * routes-04d (RC-5, RC-8): карта на всю область под шторкой. Место карты и «карты нет» — ровный фон на всю область
   * (без схлопывания); карта монтируется, когда известна высота шторки `bottomInset`.
   */
  fill?: boolean;
  /** видимая высота шторки, px; `undefined` — ещё не измерена (в `fill` карта ждёт) */
  bottomInset?: number;
}

/**
 * Карта линии маршрута без коридора (routes-01 RC-5/RC-16, routes-02 RC-15): линия, старт и финиш. SSR и первый
 * клиентский рендер — место карты (скелетон той же пропорции): env стиля и геометрия известны только после
 * монтирования. Env не задан или нативного модуля нет — блока нет (цифры карточки остаются); геометрии нет (404) —
 * тоже. Остальное — `AsyncContent` (§4.12): загрузка — скелетон, ошибка без данных — «Нет соединения» / «Не удалось
 * загрузить» с повтором (`geometry.refetch`), ошибка обновления при показанной карте — карта и баннер. `fill`
 * (routes-04d): место карты — блок на всю область без пульса (`SkeletonGroup` не растягивается), «карты нет» — фон
 * `map.background` (RC-8), карта — после измерения шторки; ошибка без данных — `AsyncContent` с повтором.
 */
export function RouteLineMap({
  mapQuery,
  accessibilityLabel,
  failedMessage,
  skeletonTestID,
  lineWidth,
  scrub,
  fill = false,
  bottomInset,
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
  const map = (data: RouteMapGeometry, url: string) => (
    <LineMap
      geometry={data}
      styleUrl={url}
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failedMessage}
      lineWidth={lineWidth}
      scrub={scrub}
      fill={fill}
      bottomInset={bottomInset}
    />
  );
  const notFound = !geometry.data && apiErrorOf(geometry.error)?.code === 'NOT_FOUND';
  if (fill) {
    const place = (testID: string, color: string) => (
      <View testID={testID} style={[styles.fill, { backgroundColor: color }]} />
    );
    const empty = place('route-line-map-empty', theme.map.background);
    if (mounted && styleUrl === null) return empty;
    if (styleUrl === null) return place(skeletonTestID, theme.surface.skeleton);
    if (notFound) return empty;
    if (geometry.data !== undefined) {
      return bottomInset === undefined
        ? place(skeletonTestID, theme.surface.skeleton)
        : map(geometry.data, styleUrl);
    }
    if (geometry.isPending && geometry.fetchStatus !== 'paused') {
      return place(skeletonTestID, theme.surface.skeleton);
    }
    return (
      <View style={styles.fill}>
        <AsyncContent query={geometry} skeleton={null}>
          {() => null}
        </AsyncContent>
      </View>
    );
  }
  if (mounted && styleUrl === null) return null;
  if (styleUrl === null) return skeleton;
  if (notFound) return null;
  return (
    <AsyncContent query={geometry} skeleton={skeleton}>
      {(data) => map(data, styleUrl)}
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
  fill,
  bottomInset,
}: {
  geometry: RouteMapGeometry;
  styleUrl: string;
  theme: ReturnType<typeof useMapStyle>['theme'];
  accessibilityLabel: string;
  failedMessage: string;
  lineWidth: number | undefined;
  scrub: ScrubStore | undefined;
  fill: boolean;
  bottomInset: number | undefined;
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
      fill={fill}
      bottomInset={bottomInset}
      styleUrl={styleUrl}
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failedMessage}
    />
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
  fill: { flex: 1 },
});
