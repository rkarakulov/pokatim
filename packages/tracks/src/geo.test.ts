import { describe, expect, it } from 'vitest';

import { haversineMeters, localProjection, trackLengthMeters } from './geo.ts';

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
