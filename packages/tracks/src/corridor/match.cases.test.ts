// Сценарии ревью pass 1 (PR #32): каждый — воспроизведение находки, красный до исправления.
import { describe, expect, it } from 'vitest';

import { analyzeAttempt, encodeTrackStream } from '../parse.ts';
import { TrackParseError, type ParsedPoint } from '../track.ts';
import {
  at,
  CENTER,
  corridorOf,
  M_LON,
  mulberry32,
  noisyRide,
  ride,
  steps,
  T0,
  timed,
  track,
  type Xy,
} from './__testing__/synthetic.ts';
import { matchCorridor } from './match.ts';
import { CORRIDOR_POLICY } from './policy.ts';
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

  it('редкая запись (15 с, шаг 150 м > 2R) на петле: два круга — два сегмента, засчитан круг, не сумма', () => {
    const LOOP: Xy[] = [
      [0, 0],
      [0, 1000],
      [1000, 1000],
      [1000, 0],
      [0, 0],
    ];
    const corridor = prepareCorridor(corridorOf(LOOP, { isLoop: true }));
    const result = brief(
      ride([[0, -95], ...LOOP, ...LOOP.slice(1), [-95, 0]], { speed: 10, intervalS: 15 }),
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

    // стоянка до старта (400 точек раз в 12 с) и после финиша (раз в 30 с) не меняет вердикт
    const parked = [...Array.from({ length: 400 }, (): Xy => [-95, 0])];
    const tail = Array.from({ length: 50 }, (): Xy => [2195, 1000]);
    const shift = 400 * 12;
    const last = seconds[seconds.length - 1]! + shift;
    const padded = timed(
      [...parked, ...before, ...after, ...tail],
      [
        ...parked.map((_, i) => i * 12),
        ...seconds.map((second) => second + shift),
        ...tail.map((_, i) => last + 30 * (i + 1)),
      ],
    );
    const withParking = brief(padded, corridor);
    expect(withParking.reasons).toEqual(['off_corridor']);
    expect(withParking.segment!.offCorridorM).toBe(result.segment!.offCorridorM);
  });

  /** Длинный маршрут (доля < 2 %), один аномальный шаг 100 с срезает угол: часть хорды вне коридора > 500 м. */
  it('аномальная срезка: непрерывный выход — часть хорды вне коридора, не только сокращение пути', () => {
    const route: Xy[] = [
      [0, 0],
      [10_000, 0],
      [10_000, 10_000],
      [40_000, 10_000],
    ];
    const corridor = prepareCorridor(corridorOf(route));
    const before = steps(-95, 9345, 10).map((x): Xy => [x, 0]);
    const after = [
      ...steps(655, 9995, 10).map((y): Xy => [10_000, y]),
      ...steps(10_005, 40_195, 10).map((x): Xy => [x, 10_000]),
    ];
    const cut: Xy[] = [
      [9350, 0],
      [10_000, 650],
    ];
    const seconds = [
      ...[...before, cut[0]!].map((_, i) => i),
      ...[cut[1]!, ...after].map((_, i) => before.length + 100 + i),
    ];
    const result = brief(timed([...before, ...cut, ...after], seconds), corridor);
    // независимо: часть хорды (9350,0)→(10000,650) дальше 50 м от маршрута, шаг 1 см
    let outside = 0;
    const chord = Math.hypot(650, 650);
    for (let i = 0; i < chord * 100; i += 1) {
      const u = (i + 0.5) / (chord * 100);
      const [x, y] = [9350 + 650 * u, 650 * u];
      const d = Math.min(Math.hypot(Math.max(0, x - 10_000), y), Math.abs(10_000 - x));
      if (Math.min(d, Math.abs(y)) > 50) outside += 0.01;
    }
    expect(outside).toBeGreaterThan(500);
    expect(result.reasons).toEqual(['off_corridor']);
    expect(Math.abs(result.segment!.maxExcursionM - outside)).toBeLessThanOrEqual(10);
    expect(result.segment!.offCorridorShare).toBeLessThan(0.02);
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
    expect(match.diagnostics).toEqual({
      corridorLengthM: 5000,
      declaredDistanceM: 5200,
      geometryLimited: false,
    });
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

// Ревью pass 3 и решение автора 2026-10-27: недобранный путь хорды — сход на каждом шаге, без частоты записи.
describe('недобранный путь и выход по хорде', () => {
  const route50: Xy[] = [
    [0, 0],
    [10_000, 0],
    [10_000, 10_000],
    [40_000, 10_000],
  ];
  const corridor50 = prepareCorridor(corridorOf(route50));
  /** 1 Гц по маршруту, кроме одного шага from → to за `cutS` секунд; `keep` — какие точки оставить. */
  const cutRide = (from: Xy, to: Xy, cutS: number, keep: (i: number) => boolean = () => true) => {
    const before = steps(-95, from[0] - 5, 10).map((x): Xy => [x, 0]);
    const after = [
      ...steps(Math.ceil((to[1] + 5) / 10) * 10 - 5, 9995, 10).map((y): Xy => [10_000, y]),
      ...steps(10_005, 40_195, 10).map((x): Xy => [x, 10_000]),
    ];
    const positions = [...before, from, to, ...after];
    const seconds = positions.map((_, i) => (i <= before.length ? i : i + cutS - 1));
    const kept = positions
      .map((position, i) => ({ position, second: seconds[i]! }))
      .filter(({ position }, i) => keep(i) || position === from || position === to);
    return timed(
      kept.map(({ position }) => position),
      kept.map(({ second }) => second),
    );
  };
  /** Выход хорды (9650,0)→(10000,y) за ±50 м — аналитически: y > 50 и x < 9950. */
  const exactOutside = (y: number) => (300 / 350 - 50 / y) * Math.hypot(350, y);

  it('выход по хорде — геометрически точно по обе стороны порога 500 м', () => {
    expect(exactOutside(551)).toBeGreaterThan(500.2);
    expect(exactOutside(550.5)).toBeLessThan(499.95);
    const over = brief(cutRide([9650, 0], [10_000, 551], 100), corridor50);
    expect(over.reasons).toEqual(['off_corridor']);
    expect(over.segment!.maxExcursionM).toBe(Math.round(exactOutside(551)));
    const under = brief(cutRide([9650, 0], [10_000, 550.5], 100), corridor50);
    expect(under.reasons).toEqual([]);
    expect(under.segment!.maxExcursionM).toBe(Math.round(exactOutside(550.5)));
  });

  // ревью pass 8: ветви ищутся во всей ширине коридора — ближняя встречная ветвь не вытесняет свою
  it('своя ветвь в 75 м, встречная в 45 м (коридор ±100 м) — засчитан без скачка', () => {
    const route: Xy[] = [
      [0, 0],
      [5000, 0],
      [5000, 120],
      [0, 120],
      [0, 2000],
    ];
    const corridor = prepareCorridor(corridorOf(route, { widthM: 100 }));
    const points = ride([[0, -120], ...route.slice(0), [0, 2200]], { speed: 8 }).map((point) => {
      const x = (point.lon - CENTER.lon) * M_LON;
      const y = (point.lat - CENTER.lat) * 111_195;
      if (x > 1000 && x < 1400 && Math.abs(y) < 1) {
        const [lon, lat] = at([x, 75]);
        return { ...point, lon, lat };
      }
      return point;
    });
    const result = brief(points, corridor);
    expect(result.reasons).toEqual([]);
    expect(result.segment!.offCorridorM).toBe(0);
  });

  /**
   * Ревью pass 8: лимит работы геометрии не меняет вердикт честного трека — случайные треки внутри коридора (шум,
   * стоянки у края коридора, медленная запись) при лимите 0 дают тот же результат, что без лимита.
   */
  it('свойство: честные треки внутри коридора — лимит геометрии 0 не меняет результат', () => {
    const policy = CORRIDOR_POLICY as { maxChordWork: number };
    const saved = policy.maxChordWork;
    const random = mulberry32(2026);
    try {
      for (let trial = 0; trial < 24; trial += 1) {
        // ломаная из 4–7 отрезков 400–1500 м с поворотами до ±100°
        const route: Xy[] = [[0, 0]];
        let heading = 0;
        const legs = 4 + Math.floor(random() * 4);
        for (let i = 0; i < legs; i += 1) {
          heading += (random() - 0.5) * (Math.PI * 1.1);
          const length = 400 + random() * 1100;
          const [x, y] = route[route.length - 1]!;
          route.push([x + length * Math.cos(heading), y + length * Math.sin(heading)]);
        }
        const widthM = 30 + Math.floor(random() * 60);
        const corridor = prepareCorridor(corridorOf(route, { widthM }));
        const speed = 1 + random() * 11;
        const sigma = random() * Math.min(10, widthM / 4);
        const base = noisyRide([[-120, 0], ...route], sigma, trial + 1, speed);
        // стоянка у края коридора середины второго отрезка: d ≈ w − 3 м, дрожание ±2 м вдоль отрезка
        const [ax, ay] = route[1]!;
        const [bx, by] = route[2]!;
        const length = Math.hypot(bx - ax, by - ay);
        const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
        const [mx, my] = [(ax + bx) / 2 + -uy * (widthM - 3), (ay + by) / 2 + ux * (widthM - 3)];
        const stop = Array.from({ length: 400 }, (_, k): ParsedPoint => {
          const [lon, lat] = at([mx + ux * 2 * (-1) ** k, my + uy * 2 * (-1) ** k]);
          return { lon, lat, time: new Date(0) };
        });
        const near = (p: ParsedPoint) =>
          Math.hypot(
            (p.lon - CENTER.lon) * M_LON - (ax + bx) / 2,
            (p.lat - CENTER.lat) * 111_195 - (ay + by) / 2,
          );
        let half = 0;
        for (let k = 1; k < base.length; k += 1) if (near(base[k]!) < near(base[half]!)) half = k;
        const points = [...base.slice(0, half), ...stop, ...base.slice(half)].map(
          (point, k): ParsedPoint => ({ ...point, time: new Date(T0 + k * 1000) }),
        );
        policy.maxChordWork = saved;
        const unlimited = matchCorridor(points, corridor, WIDE);
        policy.maxChordWork = 0;
        const limited = matchCorridor(points, corridor, WIDE);
        expect(limited.reasons, `trial ${trial}`).toEqual(unlimited.reasons);
        expect(limited.segment?.offCorridorM, `trial ${trial}`).toBe(
          unlimited.segment?.offCorridorM,
        );
      }
    } finally {
      policy.maxChordWork = saved;
    }
  });

  it('лимит работы геометрии исчерпан: за лимитом оценка консервативная — срезка остаётся сходом', () => {
    const policy = CORRIDOR_POLICY as { maxChordWork: number };
    const saved = policy.maxChordWork;
    policy.maxChordWork = 0;
    try {
      const over = brief(cutRide([9350, 0], [10_000, 650], 40), corridor50);
      expect(over.match.diagnostics.geometryLimited).toBe(true);
      expect(over.reasons).toEqual(['off_corridor']);
      expect(over.segment!.maxExcursionM).toBeGreaterThanOrEqual(779);
    } finally {
      policy.maxChordWork = saved;
    }
  });

  it('прореживание записи внутри гонки (интервалы 1/8/8 с) не скрывает срезку', () => {
    const full = brief(cutRide([9350, 0], [10_000, 650], 40), corridor50);
    expect(full.reasons).toEqual(['off_corridor']);
    const thinned = brief(
      cutRide([9350, 0], [10_000, 650], 40, (i) => i % 17 === 0 || i % 17 === 1 || i % 17 === 9),
      corridor50,
    );
    expect(thinned.reasons).toEqual(['off_corridor']);
  });

  it('автопауза: шаг через остановку (те же координаты, 10 мин) не даёт схода', () => {
    const line: Xy[] = [
      [0, 0],
      [3000, 0],
      [3000, 3000],
    ];
    const corridor = prepareCorridor(corridorOf(line));
    const moving = ride([[-95, 0], ...line.slice(1), [3000, 3200]], { speed: 10 });
    const paused = moving.map((point, i) =>
      i <= 400 ? point : { ...point, time: new Date(point.time!.getTime() + 600_000) },
    );
    const plain = brief(moving, corridor);
    const stop = brief(paused, corridor);
    expect(stop.reasons).toEqual([]);
    expect(stop.segment!.offCorridorM).toBe(plain.segment!.offCorridorM);
    expect(stop.segment!.elapsedSec).toBe(plain.segment!.elapsedSec + 600);
  });

  /**
   * Ревью pass 4: «пила» с зубцами 100 м, запись по прямой основания раз в 10 с — Δs ≈ 224 м > 1.5·хорда + 50
   * (покрытие не интерполируется), но точки сами покрывают все ячейки. Недобранный путь — на каждом шаге.
   */
  it('недобранный путь учитывается и на шаге без интерполяции покрытия (Δs > 1.5·хорда + 50)', () => {
    const saw: Xy[] = [[0, 0]];
    for (let x = 0; x < 5000; x += 100) saw.push([x + 50, 100], [x + 100, 0]);
    const corridor = prepareCorridor(corridorOf(saw));
    const points = timed(
      steps(-100, 5100, 100).map((x): Xy => [x, 0]),
      steps(0, 520, 10),
    );
    const result = brief(points, corridor);
    // Δs ≈ 2,2 хорды — редкой записью не объяснить: сход
    expect(result.reasons).toEqual(['off_corridor']);
  });

  it.each([20, 25])(
    'быстрый проезд %i м/с с шумом σ 15 м внутри коридора — засчитан (скорость шага — не сход)',
    (speed) => {
      const corridor = prepareCorridor(
        corridorOf([
          [0, 0],
          [5000, 0],
        ]),
      );
      const points = noisyRide(
        [
          [-200, 0],
          [5200, 0],
        ],
        15,
        1,
        speed,
      );
      const result = brief(points, corridor);
      expect(result.reasons).toEqual([]);
      expect(result.segment!.offCorridorM).toBe(0);
    },
  );

  describe('правдоподобие трека — по сглаженному пути (ревью pass 6)', () => {
    const straight5k = corridorOf([
      [0, 0],
      [5000, 0],
    ]);
    const attempt = (points: ParsedPoint[]) =>
      analyzeAttempt(
        encodeTrackStream({
          v: 1,
          provider: 'garmin',
          sport: 'road_cycling',
          hasHeartRate: false,
          hasPower: false,
          points: points.map((p) => [p.time!.getTime(), p.lat, p.lon, null]),
        }),
        'stream',
        straight5k,
        WIDE,
        new Date(T0 + 86_400_000),
      );

    it('25 м/с с шумом ±16 м (хорды в среднем 30,2 м/с) — засчитан', () => {
      const points = timed(
        Array.from({ length: 217 }, (_, k): Xy => [-200 + 25 * k, 16 * (-1) ** Math.floor(k / 3)]),
        Array.from({ length: 217 }, (_, k) => k),
      );
      expect(attempt(points).reasons).toEqual([]);
    });

    it('29,5 м/с с шумом σ 15 м — засчитан', () => {
      const points = noisyRide(
        [
          [-200, 0],
          [5200, 0],
        ],
        15,
        2,
        29.5,
      );
      expect(attempt(points).reasons).toEqual([]);
    });

    it('подделка: 40 м/с по сглаженному пути — implausible', () => {
      const points = ride(
        [
          [-200, 0],
          [5200, 0],
        ],
        { speed: 40 },
      );
      expect(() => attempt(points)).toThrow(TrackParseError);
    });

    // ревью pass 7: лимит работы геометрии не меняет вердикт честного трека
    it('медленная запись 1 Гц (1 м/с) с шумом ±12 м — засчитан, лимит геометрии не сработал', () => {
      const points = timed(
        Array.from({ length: 5401 }, (_, k): Xy => [-200 + k, 12 * (-1) ** k]),
        Array.from({ length: 5401 }, (_, k) => k),
      );
      const match = attempt(points);
      expect(match.reasons).toEqual([]);
      expect(match.diagnostics.geometryLimited).toBe(false);
    });

    it.each([2600, 5200])(
      'проезд 8 м/с и остановка 2 ч с дрожанием ±12 м в x = %i — засчитан',
      (stopX) => {
        const before = steps(-200, stopX, 8).map((x): Xy => [x, 0]);
        const stop = Array.from({ length: 7200 }, (_, k): Xy => [stopX, 12 * (-1) ** k]);
        const after = stopX < 5000 ? steps(stopX + 8, 5200, 8).map((x): Xy => [x, 0]) : [];
        const positions = [...before, ...stop, ...after];
        const match = attempt(
          timed(
            positions,
            positions.map((_, k) => k),
          ),
        );
        expect(match.reasons).toEqual([]);
        expect(match.diagnostics.geometryLimited).toBe(false);
      },
    );
  });

  /** Извилистая дорога y = 25·sin(x/30), коридор ±50 м: хорды между редкими точками остаются в коридоре. */
  it('редкая запись на извилистом маршруте — sparse_recording; раз в 1 с и прямая раз в 60 с — засчитаны', () => {
    const winding: Xy[] = steps(0, 6000, 5).map((x): Xy => [x, 25 * Math.sin(x / 30)]);
    const corridor = prepareCorridor(corridorOf(winding));
    const path: Xy[] = [[-95, 0], ...winding, [6200, 25 * Math.sin(200)]];
    expect(brief(ride(path, { speed: 10 }), corridor).reasons).toEqual([]);
    expect(brief(ride(path, { speed: 10, intervalS: 30 }), corridor).reasons).toEqual([
      'sparse_recording',
    ]);
    const straight = prepareCorridor(
      corridorOf([
        [0, 0],
        [6000, 0],
      ]),
    );
    const sparse = ride(
      [
        [-95, 0],
        [6700, 0],
      ],
      { speed: 10, intervalS: 60 },
    );
    expect(brief(sparse, straight).reasons).toEqual([]);
  });
});
