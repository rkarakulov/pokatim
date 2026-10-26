// Сценарии ревью pass 1 (PR #32): каждый — воспроизведение находки, красный до исправления.
import { describe, expect, it } from 'vitest';

import type { ParsedPoint } from '../track.ts';
import {
  at,
  CENTER,
  corridorOf,
  M_LON,
  noisyRide,
  ride,
  steps,
  T0,
  timed,
  track,
  type Xy,
} from './__testing__/synthetic.ts';
import { matchCorridor } from './match.ts';
import { prepareCorridor } from './prepare.ts';
import { projectTrack } from './project.ts';
import type { MatchWindow } from './types.ts';

const WIDE: MatchWindow = {
  startsAt: new Date(T0 - 3_600_000),
  closesAt: new Date(T0 + 86_400_000),
};
const OUTBACK: Xy[] = [
  [0, 0],
  [0, 10_000],
  [0, 0],
];
const outback = prepareCorridor(corridorOf(OUTBACK, { isLoop: true }));
const brief = (points: ParsedPoint[], corridor = outback) => {
  const match = matchCorridor(points, corridor, WIDE);
  return { verdict: match.verdict, reasons: match.reasons, segment: match.segment, match };
};

describe('привязка с просмотром вперёд (Витерби): развороты и ответвления', () => {
  it.each([8, 15, 30])('«туда-обратно»: разворот на %i м раньше точки маршрута — засчитан', (x) => {
    const result = brief(
      ride(
        [
          [0, -95],
          [0, 10_000 - x],
          [0, 0],
          [-95, 0],
        ],
        { speed: 10 },
      ),
    );
    expect(result.reasons).toEqual([]);
    expect(Math.abs(result.segment!.elapsedSec - (19_900 - 2 * x) / 10)).toBeLessThanOrEqual(1);
  });

  it('«туда-обратно» с шумом σ 3 м и точным разворотом — засчитаны все 20 проездов', () => {
    const rejected: number[] = [];
    for (let seed = 1; seed <= 20; seed += 1) {
      const points = noisyRide(
        [
          [0, -95],
          [0, 10_000],
          [4, 10_000],
          [4, 0],
          [-95, 0],
        ],
        3,
        seed,
      );
      if (matchCorridor(points, outback, WIDE).verdict !== 'counted') rejected.push(seed);
    }
    expect(rejected).toEqual([]);
  });

  it('ответвление посреди маршрута (тупик 2 км и назад): разворот за 20 м до конца — засчитан', () => {
    const spur: Xy[] = [
      [0, 0],
      [5000, 0],
      [5000, 2000],
      [5000, 0],
      [10_000, 0],
    ];
    const corridor = prepareCorridor(corridorOf(spur));
    const path = (turn: number): Xy[] => [
      [-95, 0],
      [5000, 0],
      [5000, turn],
      [5000, 0],
      [10_200, 0],
    ];
    expect(brief(ride(path(2000), { speed: 8 }), corridor).reasons).toEqual([]);
    expect(brief(ride(path(1980), { speed: 8 }), corridor).reasons).toEqual([]);
  });

  it('финишная ветка проходит через старт: первая точка привязывается к старту по ходу', () => {
    const route: Xy[] = [
      [0, 0],
      [3000, 0],
      [3000, 1500],
      [1000, 1500],
      [1000, 0],
      [-250, 0],
    ];
    const corridor = prepareCorridor(corridorOf(route));
    for (const y0 of [-2, 0, 2]) {
      const points = ride([[0, y0], ...route.slice(1), [-400, 0]], { speed: 8 });
      expect(projectTrack(points, corridor).s[0]).toBeLessThan(10);
      expect(brief(points, corridor).verdict, `y0 = ${y0}`).toBe('counted');
    }
  });
});

describe('ворота', () => {
  it('петля с концами в 120 м: финиш — ворота вокруг последней точки, остановка в конце засчитана', () => {
    const loop: Xy[] = [
      [0, 0],
      [0, 1500],
      [1500, 1500],
      [1500, 0],
      [120, 0],
    ];
    const corridor = prepareCorridor(corridorOf(loop, { isLoop: true }));
    const result = brief(ride([[0, -95], ...loop], { speed: 8 }), corridor);
    expect(result.reasons).toEqual([]);
    expect(Math.abs(result.segment!.elapsedSec - (5880 - 100) / 8)).toBeLessThanOrEqual(1);
  });

  it('редкая запись (30 с) на петле: два круга — два сегмента, засчитан круг, не сумма', () => {
    const LOOP: Xy[] = [
      [0, 0],
      [0, 1000],
      [1000, 1000],
      [1000, 0],
      [0, 0],
    ];
    const corridor = prepareCorridor(corridorOf(LOOP, { isLoop: true }));
    const result = brief(
      ride([[0, -95], ...LOOP, ...LOOP.slice(1), [-95, 0]], { speed: 10, intervalS: 30 }),
      corridor,
    );
    expect(result.reasons).toEqual([]);
    expect(result.match.candidates).toBeGreaterThanOrEqual(2);
    expect(result.segment!.elapsedSec).toBe(390);
  });

  it('хорда сквозь ворота дальше gapMaxM — не старт', () => {
    const line: Xy[] = [
      [0, 0],
      [5000, 0],
    ];
    const corridor = prepareCorridor(corridorOf(line));
    const points = timed(
      [[-600, 0], ...steps(600, 5200, 10).map((x): Xy => [x, 0])],
      [0, ...steps(120, 120 + 460, 1)],
    );
    expect(brief(points, corridor).reasons).toEqual(['no_start']);
  });

  it('финиш не раньше старта: ворота, пересекающиеся на линейном маршруте, — ошибка коридора', () => {
    expect(() =>
      prepareCorridor(
        corridorOf([
          [0, 0],
          [80, 0],
        ]),
      ),
    ).toThrow(/gates overlap/);
  });
});

describe('сход (A6)', () => {
  /** Прямая 40 км; два выхода на север до 200 м с возвратом между ними в точку 45 м (внутри коридора). */
  it('два отдельных выхода не складываются в один непрерывный', () => {
    const line: Xy[] = [
      [0, 0],
      [40_000, 0],
    ];
    const corridor = prepareCorridor(corridorOf(line));
    const junction = 20_005;
    const up = [...steps(5, 195, 10), 200];
    const down = [...steps(195, 55, -10), 45];
    const climb = [...steps(55, 195, 10), 200];
    const spur = [...up, ...down, ...climb, ...steps(195, 5, -10)].map((y): Xy => [junction, y]);
    const positions: Xy[] = [
      ...steps(-95, junction, 10).map((x): Xy => [x, 0]),
      ...spur,
      ...steps(junction, 40_195, 10).map((x): Xy => [x, 0]),
    ];
    const result = brief(track(positions), corridor);
    expect(result.reasons).toEqual([]);
    expect(result.segment!.maxExcursionM).toBe(300);
    expect(result.segment!.offCorridorM).toBe(600);
  });

  /** Маршрут из 6 «П»-объездов; срезка по прямой: 1 Гц, точки внутри срезок удалены (хорда «внутри → внутри»). */
  it('удалённые точки на срезке: превышение Δs над хордой на аномально длинном шаге — сход', () => {
    const route: Xy[] = [[0, 0]];
    const cuts = [1000, 2500, 4000, 5500, 7000, 8500];
    for (const x0 of cuts) route.push([x0, 0], [x0, 100], [x0 + 400, 100], [x0 + 400, 0]);
    route.push([10_000, 0]);
    const corridor = prepareCorridor(corridorOf(route));
    expect(brief(ride([[-95, 0], ...route, [10_200, 0]], { speed: 8 }), corridor).reasons).toEqual(
      [],
    );
    const cheat = ride(
      [
        [-95, 0],
        [10_200, 0],
      ],
      { speed: 8 },
    ).filter((point) => {
      const x = (point.lon - CENTER.lon) * M_LON;
      return !cuts.some((x0) => x > x0 + 5 && x < x0 + 395);
    });
    expect(brief(cheat, corridor).reasons).toEqual(['off_corridor']);
  });

  it('срезка угла одним шагом 60 с при записи 1 Гц — сход', () => {
    const route: Xy[] = [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [2000, 1000],
    ];
    const corridor = prepareCorridor(corridorOf(route));
    const before = steps(-95, 605, 10).map((x): Xy => [x, 0]);
    const after = [
      ...steps(395, 995, 10).map((y): Xy => [1000, y]),
      ...steps(1005, 2195, 10).map((x): Xy => [x, 1000]),
    ];
    const seconds = [
      ...before.map((_, i) => i),
      ...after.map((_, i) => before.length - 1 + 60 + i),
    ];
    const result = brief(timed([...before, ...after], seconds), corridor);
    expect(result.reasons).toEqual(['off_corridor']);
  });
});

describe('выбросы и коридор', () => {
  it('два выброса подряд — оба шум', () => {
    const line: Xy[] = [
      [0, 0],
      [3000, 0],
    ];
    const corridor = prepareCorridor(corridorOf(line));
    const points = ride(line, { speed: 10 });
    for (const index of [100, 101]) {
      const [lon, lat] = at([index * 10, 300]);
      points[index] = { ...points[index]!, lon, lat };
    }
    const projected = projectTrack(points, corridor);
    expect(projected.noiseTimes.length).toBe(2);
    expect(Math.max(...projected.d)).toBeLessThan(0.5);
  });

  it('distanceM расходится с линией — не исключение, а диагностика', () => {
    const line: Xy[] = [
      [0, 0],
      [5000, 0],
    ];
    const corridor = prepareCorridor(corridorOf(line, { distanceM: 5200 }));
    const match = matchCorridor(
      ride(
        [
          [-95, 0],
          [5200, 0],
        ],
        { speed: 10 },
      ),
      corridor,
      WIDE,
    );
    expect(match.verdict).toBe('counted');
    expect(match.diagnostics).toEqual({ corridorLengthM: 5000, declaredDistanceM: 5200 });
  });

  it('плотная линия (тысячи отрезков в одной ячейке) — быстрый отказ коридора', () => {
    const line = Array.from({ length: 20_000 }, (_, i): [number, number] =>
      at(i % 2 === 0 ? [0, 0] : [20, 0]),
    );
    const startedAt = performance.now();
    expect(() =>
      prepareCorridor({ line, widthM: 50, isLoop: true, distanceM: 20 * 19_999 }),
    ).toThrow(/too dense/);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
