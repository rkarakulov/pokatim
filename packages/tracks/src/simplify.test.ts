import { describe, expect, it } from 'vitest';

import type { TrackPoint } from './geo.ts';
import { simplifyTrack } from './simplify.ts';

const CENTER = { lat: 53.9, lon: 27.56 };

/** Кольцо радиусом `radiusM` из `count` точек, замкнутое (последняя = первая). */
function ring(count: number, radiusM: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const phi = (2 * Math.PI * i) / (count - 1);
    return {
      lat: CENTER.lat + (radiusM * Math.cos(phi) - radiusM) / 111_195,
      lon:
        CENTER.lon + (radiusM * Math.sin(phi)) / (111_195 * Math.cos((CENTER.lat * Math.PI) / 180)),
    };
  });
}

const distinct = (points: TrackPoint[]) => new Set(points.map((p) => `${p.lat},${p.lon}`)).size;

describe('simplifyTrack', () => {
  it('прямая сводится к концам', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ lat: 53.9 + i * 0.0001, lon: 27.56 }));
    expect(simplifyTrack(points, 5, 1000)).toEqual([points[0], points[99]]);
  });

  it('не больше maxPoints, концы сохранены', () => {
    const points = ring(5000, 4000);
    const result = simplifyTrack(points, 0.1, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.length).toBeGreaterThan(3);
    expect(result[0]).toBe(points[0]);
    expect(result[result.length - 1]).toBe(points[points.length - 1]);
  });

  it('малая петля при большом допуске — ≥ 2 различных точек', () => {
    const result = simplifyTrack(ring(50, 2), 5, 1000);
    expect(distinct(result)).toBeGreaterThanOrEqual(2);
  });

  it('вырожденная линия (одна точка, повторы одной точки) — пустой массив', () => {
    expect(simplifyTrack([], 5, 1000)).toEqual([]);
    expect(simplifyTrack([CENTER], 5, 1000)).toEqual([]);
    expect(simplifyTrack([CENTER, { ...CENTER }, { ...CENTER }], 5, 1000)).toEqual([]);
  });

  it('200 000 точек — в лимит 1000 и быстро (без рекурсии)', () => {
    const points = ring(200_000, 20_000).map((p, i) => ({
      lat: p.lat + Math.sin(i / 7) * 0.00003,
      lon: p.lon,
    }));
    const started = performance.now();
    const result = simplifyTrack(points, 5, 1000);
    const elapsedMs = performance.now() - started;
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result[0]).toBe(points[0]);
    expect(result[result.length - 1]).toBe(points[points.length - 1]);
    expect(elapsedMs).toBeLessThan(3000);
  });
});
