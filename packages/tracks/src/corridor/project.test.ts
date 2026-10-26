import { describe, expect, it } from 'vitest';

import { at, corridorOf, polylineLength, ride, T0, type Xy } from './__testing__/synthetic.ts';
import { prepareCorridor } from './prepare.ts';
import { projectTrack } from './project.ts';

const isNonDecreasing = (values: Float64Array, slackM: number) =>
  values.every((value, i) => i === 0 || value >= values[i - 1]! - slackM);

describe('projectTrack', () => {
  const line: Xy[] = [
    [0, 0],
    [2000, 0],
  ];
  const corridor = prepareCorridor(corridorOf(line));

  it('выброс (скорость в точку и из неё > 30 м/с) не участвует, счётчик моментов', () => {
    const points = ride(line, { speed: 10 });
    const [lon, lat] = at([1000, 300]);
    points[100] = { ...points[100]!, lon, lat };
    const result = projectTrack(points, corridor);
    expect(result.count).toBe(points.length - 1);
    expect(Array.from(result.noiseTimes)).toEqual([points[100]!.time!.getTime()]);
    expect(Math.max(...result.d)).toBeLessThan(0.5);
    expect(isNonDecreasing(result.s, 0)).toBe(true);
  });

  it('точки без времени игнорируются; вне радиуса поиска d = ∞, s — от предыдущей', () => {
    const points = ride(line, { speed: 10, to: 500 });
    const [lon, lat] = at([500, 400]);
    points.push({ lon, lat, time: new Date(T0 + 100_000) }, { lon, lat });
    const result = projectTrack(points, corridor);
    expect(result.count).toBe(points.length - 1);
    expect(result.d[result.count - 1]).toBe(Infinity);
    expect(result.inside[result.count - 1]).toBe(0);
    expect(result.s[result.count - 1]).toBe(result.s[result.count - 2]);
  });

  it('«туда-обратно»: обратный ход привязывается ко второй половине маршрута; первая точка — меньшая s', () => {
    const outback: Xy[] = [
      [0, 0],
      [0, 2000],
      [0, 0],
    ];
    const loop = prepareCorridor(corridorOf(outback, { isLoop: true }));
    const points = ride(
      [
        [0, -30],
        [0, 2000],
        [0, 0],
      ],
      { speed: 10 },
    );
    const result = projectTrack(points, loop);
    expect(result.s[0]).toBe(0);
    expect(isNonDecreasing(result.s, 0.5)).toBe(true);
    expect(result.s[result.count - 1]).toBeCloseTo(4000, -1);
  });

  it('восьмёрка: на самопересечении привязка остаётся на своей ветке', () => {
    const eight: Xy[] = [
      [0, 0],
      [1000, 1000],
      [1000, 0],
      [0, 1000],
    ];
    const prepared = prepareCorridor(corridorOf(eight));
    const result = projectTrack(ride(eight, { speed: 8 }), prepared);
    expect(isNonDecreasing(result.s, 0.5)).toBe(true);
    expect(result.s[result.count - 1]).toBeCloseTo(polylineLength(eight), -1);
    expect(Math.max(...result.d)).toBeLessThan(0.5);
  });
});
