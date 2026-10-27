import { describe, expect, it } from 'vitest';

import { geometryFromLine, withoutCorridor } from './geometry.ts';

describe('геометрия карты маршрута', () => {
  it('geometryFromLine (routes-05, RC-5): рамка по точкам, старт и финиш — концы линии', () => {
    const line: [number, number][] = [
      [27.5, 53.9],
      [27.7, 53.8],
      [27.6, 54.0],
    ];
    expect(geometryFromLine(line)).toEqual({
      line,
      start: [27.5, 53.9],
      finish: [27.6, 54.0],
      bounds: [27.5, 53.8, 27.7, 54.0],
    });
  });

  it('две точки — карта; одна точка, пусто, все точки совпадают (рамка в точку) — null', () => {
    expect(
      geometryFromLine([
        [27.5, 53.9],
        [27.5, 54.0],
      ])?.bounds,
    ).toEqual([27.5, 53.9, 27.5, 54.0]);
    expect(geometryFromLine([[27.5, 53.9]])).toBeNull();
    expect(geometryFromLine([])).toBeNull();
    expect(
      geometryFromLine([
        [27.5, 53.9],
        [27.5, 53.9],
      ]),
    ).toBeNull();
  });

  it('withoutCorridor: геометрия каталога + widthM 0', () => {
    const geometry = {
      line: [
        [27.5, 53.9],
        [27.6, 54.0],
      ] as [number, number][],
      start: [27.5, 53.9] as [number, number],
      finish: [27.6, 54.0] as [number, number],
      bounds: [27.5, 53.9, 27.6, 54.0] as [number, number, number, number],
    };
    expect(withoutCorridor(geometry)).toEqual({ ...geometry, widthM: 0 });
  });
});
