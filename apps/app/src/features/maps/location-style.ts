import type { CircleLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { size, stroke, type AppTheme } from '@pokatim/design-tokens';
import { CORRIDOR_OPACITY } from '@pokatim/route-view';
import type { FeatureCollection, Point } from 'geojson';

/*
 * Точка «Моё местоположение» (routes-04d, G1, RC-13) — один источник для native (`location-layer.tsx`) и web
 * (`route-map.web.tsx`, императивно).
 */

export const LOCATION_SOURCE_ID = 'my-location';

/** Зум камеры на позицию: улицы вокруг видны, маршрут рядом — тоже. */
export const LOCATE_ZOOM = 14;

export function locationFeature(lngLat: readonly [number, number]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [...lngLat] }, properties: {} },
    ],
  };
}

/**
 * Слои снизу вверх: ореол и точка. Отличима от старта и финиша (`size.iconSm`) и маркера скраббинга без цвета —
 * крупнее, с ореолом цели касания и толстой обводкой поверхности; цвет — основной текст темы.
 */
export function locationLayers(theme: AppTheme): CircleLayerSpecification[] {
  return [
    {
      id: 'my-location-halo',
      type: 'circle',
      source: LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': size.touchMin / 2,
        'circle-color': theme.text.primary,
        'circle-opacity': CORRIDOR_OPACITY,
      },
    },
    {
      id: 'my-location-dot',
      type: 'circle',
      source: LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': size.icon / 2,
        'circle-color': theme.text.primary,
        'circle-stroke-color': theme.surface.default,
        'circle-stroke-width': stroke.indicator + stroke.hairline,
      },
    },
  ];
}
