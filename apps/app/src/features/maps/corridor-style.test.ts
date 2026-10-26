/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { size, stroke, themes } from '@pokatim/design-tokens';

import {
  centerLat,
  CORRIDOR_OPACITY,
  corridorLineWidth,
  metersPerPixel,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';

const map: RaceRouteMap = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
  widthM: 50,
};

describe('corridor-style (maps-01)', () => {
  it('метров на пиксель: экватор на zoom 0 — 78271.517, на 53.9° и zoom 22 — по косинусу и 2^22', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 3);
    const lat = 53.9;
    expect(metersPerPixel(lat, 22)).toBeCloseTo(
      (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** 22,
      9,
    );
    expect(metersPerPixel(lat, 22)).toBeCloseTo(0.01103, 4);
  });

  it('центр рамки по широте', () => {
    expect(centerLat(map.bounds)).toBeCloseTo(53.9, 9);
  });

  it('ширина коридора: interpolate exponential 2 по zoom, опоры 0 и 22 — 2 × widthM / mpp', () => {
    const lat = 53.9;
    const expression = corridorLineWidth(50, lat);
    expect(expression.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
    const [, , , z0, w0, z22, w22] = expression;
    expect([z0, z22]).toEqual([0, 22]);
    expect(w0).toBeCloseTo(100 / metersPerPixel(lat, 0), 9);
    expect(w22).toBeCloseTo(100 / metersPerPixel(lat, 22), 6);
    // на zoom 22 коридор ±50 м — тысячи пикселей; на zoom 0 — доли пикселя
    expect(w22 as number).toBeGreaterThan(9000);
    expect(w0 as number).toBeLessThan(0.01);
  });

  it('GeoJSON: линия маршрута и точки старта и финиша с kind', () => {
    const features = routeFeatures(map);
    expect(features.type).toBe('FeatureCollection');
    expect(features.features.map((feature) => feature.geometry)).toEqual([
      { type: 'LineString', coordinates: map.line },
      { type: 'Point', coordinates: map.start },
      { type: 'Point', coordinates: map.finish },
    ]);
    expect(features.features.map((feature) => feature.properties?.kind)).toEqual([
      'route',
      'start',
      'finish',
    ]);
  });

  it('слои: коридор (map.corridor, прозрачность), осевая (map.route), старт и финиш различимы без цвета', () => {
    const theme = themes.light;
    const layers = routeLayers(theme, map.widthM, map.bounds);
    expect(layers.map((layer) => layer.id)).toEqual(['corridor', 'route', 'start', 'finish']);
    expect(layers.every((layer) => layer.source === ROUTE_SOURCE_ID)).toBe(true);
    const [corridor, route, start, finish] = layers;
    expect(corridor).toMatchObject({
      type: 'line',
      paint: {
        'line-color': theme.map.corridor,
        'line-opacity': CORRIDOR_OPACITY,
        'line-width': corridorLineWidth(map.widthM, 53.9),
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    expect(route).toMatchObject({
      type: 'line',
      paint: { 'line-color': theme.map.route, 'line-width': stroke.indicator },
    });
    expect(start).toMatchObject({
      type: 'circle',
      paint: {
        'circle-radius': size.iconSm / 2,
        'circle-color': theme.map.route,
        'circle-stroke-color': theme.map.background,
        'circle-stroke-width': stroke.indicator,
      },
    });
    expect(finish).toMatchObject({
      type: 'circle',
      paint: { 'circle-color': theme.map.background, 'circle-stroke-color': theme.map.route },
    });
    expect(routeLayers(themes.dark, map.widthM, map.bounds)[1]).toMatchObject({
      paint: { 'line-color': themes.dark.map.route },
    });
  });
});
