import type {
  CircleLayerSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { RideMapPoint } from '@pokatim/contracts';
import { size, stroke, type AppTheme } from '@pokatim/design-tokens';
import { boundsOf, type Bounds } from '@pokatim/tracks';
import type { FeatureCollection, Point } from 'geojson';

/*
 * Точки старта на карте ленты райдов (05c, RC-11) — один источник для native (`ride-points-map.tsx`) и web
 * (`ride-points-map.web.tsx`): группировка райдов с одинаковым стартом (популярный маршрут), GeoJSON, слои и рамка
 * камеры. В свойствах точки — только ключ группы и число райдов (ни названий, ни id).
 */

export const RIDE_POINTS_SOURCE_ID = 'ride-points';
export const RIDE_POINTS_LAYER_ID = 'ride-points';
const COUNT_LAYER_ID = 'ride-points-count';

/** Расширение рамки одной точки (и пустой карты вокруг центра города), градусы: ±0,05° ≈ 5 км. */
export const POINT_PAD_DEG = 0.05;

/** Шрифт числа у группы — глифы стиля OpenFreeMap (`deploy-dev.yml`, ADR-0014). */
const COUNT_FONT = ['Noto Sans Regular'];

/** Ключ точки: координаты до 1e-5° (~1 м) — один старт маршрута у нескольких райдов. */
export const pointKey = ([lon, lat]: readonly [number, number]) =>
  `${lon.toFixed(5)},${lat.toFixed(5)}`;

/** Группы райдов по точке старта; порядок — по первому райду группы (вход уже по времени). */
export function rideGroups(points: readonly RideMapPoint[]): Map<string, RideMapPoint[]> {
  const groups = new Map<string, RideMapPoint[]>();
  for (const point of points) {
    const key = pointKey(point.start);
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }
  return groups;
}

export interface RidePointProperties {
  key: string;
  count: number;
}

export function ridePointFeatures(
  points: readonly RideMapPoint[],
): FeatureCollection<Point, RidePointProperties> {
  return {
    type: 'FeatureCollection',
    features: [...rideGroups(points)].map(([key, group]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [...group[0]!.start] },
      properties: { key, count: group.length },
    })),
  };
}

/**
 * Слои снизу вверх: круг (заливка — линия маршрута темы, обводка — фон карты; у группы крупнее — различим без
 * числа) и число райдов группы. Только роли `theme.map.*`.
 */
export function ridePointLayers(
  theme: AppTheme,
): [CircleLayerSpecification, SymbolLayerSpecification] {
  const group = ['>', ['get', 'count'], 1] as ['>', ['get', string], number];
  return [
    {
      id: RIDE_POINTS_LAYER_ID,
      type: 'circle',
      source: RIDE_POINTS_SOURCE_ID,
      paint: {
        'circle-radius': ['case', group, size.touchMin / 3, size.icon / 2],
        'circle-color': theme.map.route,
        'circle-stroke-color': theme.map.background,
        'circle-stroke-width': stroke.indicator,
      },
    },
    {
      id: COUNT_LAYER_ID,
      type: 'symbol',
      source: RIDE_POINTS_SOURCE_ID,
      filter: group,
      layout: {
        'text-field': ['to-string', ['get', 'count']],
        'text-font': COUNT_FONT,
        'text-size': size.iconSm - stroke.indicator,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': theme.map.background },
    },
  ];
}

const padded = (min: number, max: number): [number, number] =>
  max - min < POINT_PAD_DEG * 2
    ? [(min + max) / 2 - POINT_PAD_DEG, (min + max) / 2 + POINT_PAD_DEG]
    : [min, max];

/**
 * Рамка камеры: точки и позиция «Рядом»; узкая (одна точка) — до ±0,05° по оси; нет ни точек, ни позиции — вокруг
 * `fallback` (центр выбранного города или Минска).
 */
export function pointsBounds(
  points: readonly RideMapPoint[],
  me: readonly [number, number] | null,
  fallback: readonly [number, number],
): Bounds {
  const coords = points.map((point) => point.start);
  const raw = boundsOf(me ? [...coords, me] : coords) ?? [...fallback, ...fallback];
  const [west, east] = padded(raw[0], raw[2]);
  const [south, north] = padded(raw[1], raw[3]);
  return [west, south, east, north];
}
