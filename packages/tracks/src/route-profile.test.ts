import { describe, expect, it } from 'vitest';

import { trackLengthMeters, type TrackPoint } from './geo.ts';
import {
  ROUTE_PROFILE_MAX_POINTS,
  ROUTE_PROFILE_MIN_STEP_M,
  elevationProfile,
} from './route-profile.ts';

/** Прямая на восток от (27.5, 53.9): `count` точек через `stepDeg` по долготе, высота — `ele(i)`. */
const line = (
  count: number,
  stepDeg: number,
  ele: (i: number) => number | undefined,
): TrackPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const value = ele(i);
    return value === undefined
      ? { lon: 27.5 + i * stepDeg, lat: 53.9 }
      : { lon: 27.5 + i * stepDeg, lat: 53.9, ele: value };
  });

const expectShape = (profile: [number, number][], points: readonly TrackPoint[]) => {
  const distanceM = Math.round(trackLengthMeters(points));
  expect(profile.length).toBeLessThanOrEqual(ROUTE_PROFILE_MAX_POINTS);
  expect(profile[0]![0]).toBe(0);
  expect(profile.at(-1)![0]).toBe(distanceM);
  for (let i = 1; i < profile.length; i += 1) {
    expect(profile[i]![0]).toBeGreaterThan(profile[i - 1]![0]);
  }
  for (const [d, e] of profile) {
    expect(Number.isInteger(d)).toBe(true);
    expect(Number.isInteger(e)).toBe(true);
  }
};

describe('elevationProfile', () => {
  it('длинный маршрут: ≤ 300 точек, шаг ≥ 25 м, концы — 0 и длина, целые', () => {
    // ~65 км, высота плавно растёт
    const points = line(1000, 0.001, (i) => 200 + i * 0.1);
    const profile = elevationProfile(points)!;
    expectShape(profile, points);
    expect(profile).toHaveLength(ROUTE_PROFILE_MAX_POINTS);
    expect(profile[1]![0] - profile[0]![0]).toBeGreaterThanOrEqual(ROUTE_PROFILE_MIN_STEP_M);
    expect(profile[0]![1]).toBeGreaterThanOrEqual(200);
    expect(profile.at(-1)![1]).toBeLessThanOrEqual(300);
  });

  it('короткий маршрут: шаг 25 м — floor(D / 25) + 1 точек', () => {
    // ~1,05 км
    const points = line(17, 0.001, () => 210);
    const distanceM = trackLengthMeters(points);
    const profile = elevationProfile(points)!;
    expectShape(profile, points);
    expect(profile).toHaveLength(Math.floor(distanceM / ROUTE_PROFILE_MIN_STEP_M) + 1);
    expect(profile.length).toBeGreaterThanOrEqual(41);
  });

  it('высот нет — null', () => {
    expect(elevationProfile(line(50, 0.001, () => undefined))).toBeNull();
    expect(elevationProfile(line(50, 0.001, () => Number.NaN))).toBeNull();
  });

  it('одна высота — ровный профиль на всю длину', () => {
    const points = line(100, 0.001, (i) => (i === 40 ? 180 : undefined));
    const profile = elevationProfile(points)!;
    expectShape(profile, points);
    expect(new Set(profile.map(([, e]) => e))).toEqual(new Set([180]));
  });

  it('точки без высоты — линейная интерполяция по дистанции между соседями с высотой', () => {
    // высоты только у первой (100) и последней (200) точек: середина ≈ 150
    const points = line(200, 0.001, (i) => (i === 0 ? 100 : i === 199 ? 200 : undefined));
    const profile = elevationProfile(points)!;
    expectShape(profile, points);
    const middle = profile[Math.floor(profile.length / 2)]!;
    expect(Math.abs(middle[1] - 150)).toBeLessThanOrEqual(1);
    for (let i = 1; i < profile.length; i += 1) {
      expect(profile[i]![1]).toBeGreaterThanOrEqual(profile[i - 1]![1]);
    }
  });

  it('всплеск GPS +50 м на одной точке гасится окном шага', () => {
    // точки через ~5 м, ~2 км: окно шага (25 м) — ~5 точек
    const points = line(400, 0.000_076, (i) => (i === 200 ? 250 : 200));
    const profile = elevationProfile(points)!;
    expectShape(profile, points);
    const max = Math.max(...profile.map(([, e]) => e));
    expect(max).toBeLessThan(225);
    expect(Math.min(...profile.map(([, e]) => e))).toBe(200);
  });
});
