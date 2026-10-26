import { describe, expect, it } from 'vitest';

import {
  boundsNear,
  boundsOf,
  haversineMeters,
  localProjection,
  trackLengthMeters,
  type Bounds,
} from './geo.ts';

describe('geo', () => {
  const minsk = { lat: 53.9006, lon: 27.559 };
  const brest = { lat: 52.0976, lon: 23.7341 };

  it('считает расстояние Минск — Брест ≈ 326 км', () => {
    expect(haversineMeters(minsk, brest) / 1000).toBeCloseTo(326, -1);
  });

  it('длина трека из одной точки = 0', () => {
    expect(trackLengthMeters([minsk])).toBe(0);
  });

  it('локальная проекция на масштабе сотен метров совпадает с haversine (< 0,1 %)', () => {
    const { kx, ky } = localProjection(minsk.lat);
    const other = { lat: minsk.lat + 0.003, lon: minsk.lon + 0.004 };
    const planar = Math.hypot((other.lon - minsk.lon) * kx, (other.lat - minsk.lat) * ky);
    expect(Math.abs(planar - haversineMeters(minsk, other)) / planar).toBeLessThan(0.001);
    expect(localProjection(0).kx).toBeCloseTo(localProjection(0).ky, 9);
  });
});

describe('рамки', () => {
  const M_LAT = 111_195;
  const lat0 = 53.9;
  const mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  const a: Bounds = [27.5, lat0, 27.51, lat0 + 0.01];

  it('boundsOf: пустой вход — null, иначе min/max по осям', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        [27.5, 53.9],
        [27.4, 54.0],
        [27.6, 53.8],
      ]),
    ).toEqual([27.4, 53.8, 27.6, 54.0]);
  });

  it('boundsNear: пересечение и маржа в метрах по широте', () => {
    expect(boundsNear(a, a, 0)).toBe(true);
    const north = (gapM: number): Bounds => [
      27.5,
      lat0 + 0.01 + gapM / M_LAT,
      27.51,
      lat0 + 0.02 + gapM / M_LAT,
    ];
    expect(boundsNear(a, north(590), 600)).toBe(true);
    expect(boundsNear(a, north(610), 600)).toBe(false);
  });

  it('boundsNear: маржа по долготе — метры на широте рамки, симметрично', () => {
    const east = (gapM: number): Bounds => [
      27.51 + gapM / mLon,
      lat0,
      27.52 + gapM / mLon,
      lat0 + 0.01,
    ];
    expect(boundsNear(a, east(590), 600)).toBe(true);
    expect(boundsNear(a, east(620), 600)).toBe(false);
    expect(boundsNear(east(620), a, 600)).toBe(false);
  });
});
