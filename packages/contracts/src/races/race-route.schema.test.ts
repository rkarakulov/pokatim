import { describe, expect, it } from 'vitest';

import { RACE_ROUTE_MAX_POINTS, RaceRouteMap } from './race-route.schema.ts';

const valid = {
  line: [
    [27.55, 53.9],
    [27.56, 53.91],
  ],
  start: [27.55, 53.9],
  finish: [27.56, 53.91],
  bounds: [27.55, 53.9, 27.56, 53.91],
  widthM: 50,
};

describe('RaceRouteMap (maps-01)', () => {
  it('валидный ответ разбирается', () => {
    expect(RaceRouteMap.parse(valid)).toEqual(valid);
  });

  it('линия 1 точка и больше лимита, широта 91, долгота 181, bounds из 3 чисел, widthM 0 — ошибка', () => {
    const point: [number, number] = [27.5, 53.9];
    for (const broken of [
      { ...valid, line: [point] },
      { ...valid, line: Array.from({ length: RACE_ROUTE_MAX_POINTS + 1 }, () => point) },
      { ...valid, start: [27.5, 91] },
      { ...valid, finish: [181, 53.9] },
      { ...valid, bounds: [27.55, 53.9, 27.56] },
      { ...valid, widthM: 0 },
    ]) {
      expect(RaceRouteMap.safeParse(broken).success, JSON.stringify(broken).slice(0, 80)).toBe(
        false,
      );
    }
    expect(
      RaceRouteMap.safeParse({
        ...valid,
        line: Array.from({ length: RACE_ROUTE_MAX_POINTS }, () => point),
      }).success,
    ).toBe(true);
  });
});
