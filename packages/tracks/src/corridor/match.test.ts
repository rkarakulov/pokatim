import { describe, expect, it } from 'vitest';

import { corridorOf, ride, steps, T0, track, type Xy } from './__testing__/synthetic.ts';
import { matchCorridor, matchCorridorDetailed } from './match.ts';
import { CORRIDOR_ENGINE_VERSION } from './policy.ts';
import { prepareCorridor } from './prepare.ts';
import type { MatchWindow } from './types.ts';

const WIDE: MatchWindow = {
  startsAt: new Date(T0 - 3_600_000),
  closesAt: new Date(T0 + 86_400_000),
};
const line = (length: number): Xy[] => [
  [0, 0],
  [length, 0],
];
const straight = (length: number) => prepareCorridor(corridorOf(line(length)));

/** Прямой маршрут вдоль параллели, ответвление на север (меридиан) глубиной `depth` в точке `junction` и назад. */
function spurRide(length: number, junction: number, depth: number): Xy[] {
  const along = (xs: number[]): Xy[] => xs.map((x) => [x, 0]);
  const up = steps(5, depth - 1, 10);
  const spur = [...up, depth, ...[...up].reverse()].map((y): Xy => [junction, y]);
  return [...along(steps(-95, junction, 10)), ...spur, ...along(steps(junction, length + 195, 10))];
}

const LOOP: Xy[] = [
  [0, 0],
  [0, 1000],
  [1000, 1000],
  [1000, 0],
  [0, 0],
];
const loopCorridor = prepareCorridor(corridorOf(LOOP, { isLoop: true }));
const lapPath: Xy[] = [[0, -95], ...LOOP, [-100, 0]];

describe('matchCorridor', () => {
  it('интерполяция ворот: момент пересечения окружности — аналитически (± 1 мс)', () => {
    const points = ride(
      [
        [-95, 0],
        [5100, 0],
      ],
      { speed: 7, intervalS: 10 },
    );
    const match = matchCorridor(points, straight(5000), WIDE);
    expect(match).toMatchObject({
      engineVersion: CORRIDOR_ENGINE_VERSION,
      verdict: 'counted',
      reasons: [],
      touchedCorridor: true,
    });
    const segment = match.segment!;
    expect(Math.abs(segment.startedAt.getTime() - (T0 + (145 / 7) * 1000))).toBeLessThanOrEqual(1);
    expect(Math.abs(segment.finishedAt.getTime() - (T0 + (5045 / 7) * 1000))).toBeLessThanOrEqual(
      1,
    );
    expect(segment.elapsedSec).toBe(Math.round(4900 / 7));
    expect(segment.distanceM).toBe(4900);
    expect(segment.coverage).toBe(1);
  });

  it('топтание на старте: выходы в пределах 60 с схлопываются в последний', () => {
    const forward = (from: number, to: number) => steps(from, to, 10).map((x): Xy => [x, 0]);
    const positions = [
      ...forward(-95, 75),
      ...steps(65, -25, -10).map((x): Xy => [x, 0]),
      ...forward(-15, 75),
      ...steps(65, -25, -10).map((x): Xy => [x, 0]),
      ...forward(-15, 3195),
    ];
    const lastExit = positions.lastIndexOf(positions.find(([x]) => x === 45)!);
    const match = matchCorridor(track(positions), straight(3000), WIDE);
    expect(match.verdict).toBe('counted');
    expect(match.candidates).toBe(1);
    const lastCrossing = positions.findLastIndex(
      ([x], i) => x === 45 && positions[i + 1]![0] === 55,
    );
    expect(lastCrossing).toBeGreaterThanOrEqual(lastExit);
    expect(match.segment!.startedAt.getTime()).toBe(T0 + lastCrossing * 1000 + 500);

    // ожидание в воротах дольше 60 с — два кандидата, засчитан последний (лучший по времени)
    const waited = [
      ...forward(-95, 75),
      ...steps(65, 5, -10).map((x): Xy => [x, 0]),
      ...Array.from({ length: 90 }, (): Xy => [5, 0]),
      ...forward(15, 3195),
    ];
    const second = matchCorridor(track(waited), straight(3000), WIDE);
    expect(second.candidates).toBe(2);
    expect(second.verdict).toBe('counted');
  });

  it('петля: выход со старта и мгновенный вход не дают нулевого сегмента', () => {
    const match = matchCorridor(ride(lapPath, { speed: 8 }), loopCorridor, WIDE);
    expect(match.verdict).toBe('counted');
    expect(Math.abs(match.segment!.elapsedMs - (3900 / 8) * 1000)).toBeLessThanOrEqual(2);
    expect(match.segment!.coverage).toBe(1);
  });

  it('два круга — засчитан лучший круг', () => {
    const lap1 = ride([[0, -95], ...LOOP], { speed: 8 });
    const lap2 = ride([...LOOP, [-100, 0]], {
      speed: 10,
      startMs: lap1[lap1.length - 1]!.time!.getTime() + 1000,
      from: 10,
    });
    const match = matchCorridor([...lap1, ...lap2], loopCorridor, WIDE);
    expect(match.verdict).toBe('counted');
    expect(match.segment!.elapsedSec).toBe(390);
  });

  it('пороги A6 строгие: ровно 2 % и ровно 500 м — засчитано, больше — off_corridor', () => {
    const exact = matchCorridor(track(spurRide(24_500, 10_005, 300)), straight(24_500), WIDE);
    expect(exact.verdict).toBe('counted');
    expect(exact.segment).toMatchObject({
      distanceM: 25_000,
      offCorridorM: 500,
      offCorridorShare: 0.02,
      maxExcursionM: 500,
    });

    const longer = matchCorridor(track(spurRide(30_000, 10_005, 310)), straight(30_000), WIDE);
    expect(longer.reasons).toEqual(['off_corridor']);
    expect(longer.segment!.maxExcursionM).toBe(520);

    // чуть больше порога — уже сход: A6 сравнивается по неокруглённым метрам (допуск — 1 см квантования)
    const above = matchCorridor(track(spurRide(24_500, 10_005, 300.2)), straight(24_500), WIDE);
    expect(above.reasons).toEqual(['off_corridor']);
    expect(above.segment!.maxExcursionM).toBe(500);

    const share = matchCorridor(track(spurRide(24_400, 10_005, 300)), straight(24_400), WIDE);
    expect(share.reasons).toEqual(['off_corridor']);
    expect(share.segment!.maxExcursionM).toBe(500);
    expect(share.segment!.offCorridorShare).toBeGreaterThan(0.02);
  });

  it('окно — по моментам ворот, closesAt исключающая', () => {
    const points = ride(
      [
        [-95, 0],
        [5200, 0],
      ],
      { speed: 10 },
    );
    const corridor = straight(5000);
    const start = T0 + 14_500;
    const finish = T0 + 504_500;
    const check = (startsAt: number, closesAt: number) =>
      matchCorridor(points, corridor, {
        startsAt: new Date(startsAt),
        closesAt: new Date(closesAt),
      }).reasons;
    expect(check(T0 + 10_000, finish + 1)).toEqual([]);
    expect(check(start + 1, finish + 1)).toEqual(['outside_window']);
    expect(check(start, finish)).toEqual(['outside_window']);
  });

  it('коды — в порядке проверок: сход, затем окно', () => {
    const match = matchCorridor(track(spurRide(30_000, 10_005, 450)), straight(30_000), {
      startsAt: new Date(T0 + 60_000),
      closesAt: WIDE.closesAt,
    });
    expect(match.verdict).toBe('rejected');
    expect(match.reasons).toEqual(['off_corridor', 'outside_window']);
    expect(match.segment).not.toBeNull();
  });

  it('matchCorridorDetailed: выход на ответвление — один интервал по шагам вне коридора, match не меняется', () => {
    // точка раз в секунду: 1015-я — y = 45 (внутри), 1016-я — y = 55 (снаружи) … 1066-я — y = 55, 1067-я — y = 45
    const points = track(spurRide(24_500, 10_005, 300));
    const corridor = straight(24_500);
    const { match, offRunsMs } = matchCorridorDetailed(points, corridor, WIDE);
    expect(match).toEqual(matchCorridor(points, corridor, WIDE));
    expect(offRunsMs).toEqual([[T0 + 1_015_000, T0 + 1_067_000]]);
  });
});
