/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { size, stroke, themes } from '@pokatim/design-tokens';

import {
  centerLat,
  CORRIDOR_MIN_WIDTH_PX,
  CORRIDOR_OPACITY,
  corridorLineWidth,
  metersPerPixel,
  ROUTE_CATALOG_LINE_WIDTH,
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

  /** Значение `interpolate exponential 2` по опорам `[z, w, …]` на зуме `zoom`. */
  const widthAt = (expression: ReturnType<typeof corridorLineWidth>, zoom: number) => {
    const stops = (expression.slice(3) as number[]).reduce<[number, number][]>(
      (pairs, value, i, all) => (i % 2 === 0 ? [...pairs, [value, all[i + 1]!]] : pairs),
      [],
    );
    const b = stops.findIndex(([z]) => z >= zoom);
    if (b < 0) return stops.at(-1)![1];
    if (b === 0) return stops[0]![1];
    const [za, wa] = stops[b - 1]!;
    const [zb, wb] = stops[b]!;
    const t = (2 ** (zoom - za) - 1) / (2 ** (zb - za) - 1);
    return wa + t * (wb - wa);
  };

  it('ширина коридора (B3 maps-02): max(2 × widthM / mpp, минимум px) на всех зумах, exponential 2 по zoom', () => {
    const lat = 53.9;
    const expression = corridorLineWidth(50, lat);
    expect(expression.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
    expect(CORRIDOR_MIN_WIDTH_PX).toBeGreaterThan(stroke.indicator * 2);
    for (const zoom of [0, 5, 9, 10, 11, 12, 13, 14, 16, 18, 22]) {
      const metric = 100 / metersPerPixel(lat, zoom);
      expect(widthAt(expression, zoom)).toBeCloseTo(Math.max(metric, CORRIDOR_MIN_WIDTH_PX), 4);
    }
    // обзорный зум маршрута ~60 км: метрически 2–4 px — показывается минимум
    expect(100 / metersPerPixel(lat, 10)).toBeLessThan(CORRIDOR_MIN_WIDTH_PX);
    expect(widthAt(expression, 10)).toBe(CORRIDOR_MIN_WIDTH_PX);
    // на zoom 22 коридор ±50 м — тысячи пикселей
    expect(widthAt(expression, 22)).toBeGreaterThan(9000);
    // опоры строго по возрастанию (иначе MapLibre отвергнет выражение)
    const zooms = (expression.slice(3) as number[]).filter((_, i) => i % 2 === 0);
    expect([...zooms].sort((a, b) => a - b)).toEqual(zooms);
    expect(new Set(zooms).size).toBe(zooms.length);
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

describe('толщина линии маршрута (routes-03, RC-8)', () => {
  it('по умолчанию — stroke.indicator; lineWidth — в слое route; каталог — 5 px', () => {
    expect(ROUTE_CATALOG_LINE_WIDTH).toBe(5);
    const width = (layers: ReturnType<typeof routeLayers>) =>
      layers.find((layer) => layer.id === 'route')!.paint!['line-width' as never];
    expect(width(routeLayers(themes.light, map.widthM, map.bounds))).toBe(stroke.indicator);
    expect(width(routeLayers(themes.light, map.widthM, map.bounds, ROUTE_CATALOG_LINE_WIDTH))).toBe(
      5,
    );
  });
});
