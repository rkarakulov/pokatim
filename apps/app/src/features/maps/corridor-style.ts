import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { RaceRouteMap } from '@pokatim/contracts';
import { size, stroke, type AppTheme } from '@pokatim/design-tokens';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

/*
 * Оформление карты коридора гонки (ADR-0014 п. 6) — один источник для native и web: GeoJSON маршрута и спецификации
 * слоёв MapLibre из ролей темы `map.*`. Коридор — линия маршрута шириной 2 × `widthM` в метрах (выражение зума).
 */

/** id слоя коридора — без коридора (`RouteMap corridor={false}`, маршрут каталога) слой не создаётся. */
export const CORRIDOR_LAYER_ID = 'corridor';

/** id источника GeoJSON маршрута на карте. */
export const ROUTE_SOURCE_ID = 'race-route';

/**
 * Прозрачность коридора под осевой линией: токена прозрачности в дизайн-системе нет (RC-5, follow-up — токены карты
 * в app-foundation вместе с maps-02).
 */
export const CORRIDOR_OPACITY = 0.3;

/** Пропорция блока карты (раскладка, не px — RC-5): ≈ 220 при ширине телефона, без сдвига вёрстки. */
export const MAP_ASPECT_RATIO = 3 / 2;

/** Отступ рамки маршрута от краёв карты, px экрана — шаг сетки дизайн-системы. */
export const MAP_PADDING = size.icon * 2;

/** Метров на пиксель на экваторе при zoom 0 для тайлов 512 px (MapLibre). */
const EQUATOR_METERS_PER_PIXEL = 78271.517;
const MAX_ZOOM = 22;

export function metersPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_METERS_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Широта центра рамки `[west, south, east, north]`. */
export function centerLat(bounds: RaceRouteMap['bounds']): number {
  return (bounds[1] + bounds[3]) / 2;
}

/**
 * Ширина линии коридора в пикселях: 2 × `widthM` метров на широте `lat`. Метры на пиксель при каждом шаге зума
 * делятся на 2 — `interpolate exponential 2` между опорами 0 и 22 точен на всех уровнях.
 */
export function corridorLineWidth(widthM: number, lat: number): ExpressionSpecification {
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    0,
    (2 * widthM) / metersPerPixel(lat, 0),
    MAX_ZOOM,
    (2 * widthM) / metersPerPixel(lat, MAX_ZOOM),
  ];
}

type RouteKind = 'route' | 'start' | 'finish';
type RouteFeature = Feature<LineString | Point, { kind: RouteKind }>;

/** GeoJSON маршрута: линия показа + точки старта и финиша (`properties.kind`). */
export function routeFeatures(
  map: RaceRouteMap,
): FeatureCollection<LineString | Point, { kind: RouteKind }> {
  const point = (kind: 'start' | 'finish', coordinates: [number, number]): RouteFeature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: { kind },
  });
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: map.line },
        properties: { kind: 'route' },
      },
      point('start', map.start),
      point('finish', map.finish),
    ],
  };
}

export type RouteLayer = LineLayerSpecification | CircleLayerSpecification;

const kindIs = (kind: RouteKind): ExpressionSpecification => ['==', ['get', 'kind'], kind];

/**
 * Слои снизу вверх: коридор, осевая линия, старт и финиш. Старт — заливка цветом маршрута, финиш — фоном с обводкой
 * маршрута: различимы без цвета (RC-5).
 */
export function routeLayers(
  theme: AppTheme,
  widthM: number,
  bounds: RaceRouteMap['bounds'],
): RouteLayer[] {
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const circle = (
    kind: 'start' | 'finish',
    fill: string,
    outline: string,
  ): CircleLayerSpecification => ({
    id: kind,
    type: 'circle',
    source: ROUTE_SOURCE_ID,
    filter: kindIs(kind),
    paint: {
      'circle-radius': size.iconSm / 2,
      'circle-color': fill,
      'circle-stroke-color': outline,
      'circle-stroke-width': stroke.indicator,
    },
  });
  return [
    {
      id: CORRIDOR_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: kindIs('route'),
      layout: round,
      paint: {
        'line-color': theme.map.corridor,
        'line-opacity': CORRIDOR_OPACITY,
        'line-width': corridorLineWidth(widthM, centerLat(bounds)),
      },
    },
    {
      id: 'route',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: kindIs('route'),
      layout: round,
      paint: { 'line-color': theme.map.route, 'line-width': stroke.indicator },
    },
    circle('start', theme.map.route, theme.map.background),
    circle('finish', theme.map.background, theme.map.route),
  ];
}
