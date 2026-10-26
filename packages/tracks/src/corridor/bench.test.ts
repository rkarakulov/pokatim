import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import {
  analyzeAttempt,
  encodeTrackStream,
  TrackParseError,
  type TrackStreamV1,
} from '../parse.ts';
import type { ParsedPoint } from '../track.ts';
import { at, corridorOf, pointAt, polylineLength, T0, type Xy } from './__testing__/synthetic.ts';
import { matchCorridor } from './match.ts';
import { CORRIDOR_POLICY } from './policy.ts';
import { prepareCorridor } from './prepare.ts';
import type { CorridorMatch, MatchWindow } from './types.ts';

const POINTS = 200_000;
const INTERVAL_MS = 500;
/**
 * Бюджеты AC14 строгие локально; на CI (общая медленная машина, параллельные задачи, шумные замеры памяти) — с
 * множителем 3: CI ловит регрессии на порядок, а не дрожание раннера. Строгий прогон: `pnpm --filter @pokatim/tracks
 * exec vitest run src/corridor/bench.test.ts` без `CI`.
 */
const CI_BUDGET_FACTOR = process.env.CI ? 3 : 1;
const TIME_LIMIT_MS = 3000 * CI_BUDGET_FACTOR;
/**
 * Искусственный худший случай (злонамеренный трек на пределе лимита работы) — не честный трек: его граница — запас до
 * таймаута потока разбора (30 с), а не бюджет обычного трека. На CI машина в ~8–10 раз медленнее локальной.
 */
const ADVERSARIAL_TIME_LIMIT_MS = 8000 * CI_BUDGET_FACTOR;
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024 * CI_BUDGET_FACTOR;

/** Маршрут 200 км «змейкой»: 20 × (9,5 км на восток/запад + 0,5 км на север); вершины линии — раз в 100 м. */
function longRoute(): Xy[] {
  const corners: Xy[] = [[0, 0]];
  for (let i = 0; i < 20; i += 1) {
    const [x, y] = corners[corners.length - 1]!;
    const east = i % 2 === 0 ? 9500 : -9500;
    corners.push([x + east, y], [x + east, y + 500]);
  }
  const total = polylineLength(corners);
  return Array.from({ length: Math.floor(total / 100) + 1 }, (_, i) =>
    pointAt(corners, Math.min(i * 100, total)),
  );
}

/** 200 000 точек раз в 0,5 с по 1 м (2 м/с, ≈ 28 ч) с боковым шумом ± 4 м. */
function longRide(route: readonly Xy[]): ParsedPoint[] {
  // вершины маршрута — раз в 100 м: точка k — между вершинами ⌊k/100⌋ и следующей
  return Array.from({ length: POINTS }, (_, k) => {
    const i = Math.min(Math.floor(k / 100), route.length - 2);
    const [x, y] = pointAt([route[i]!, route[i + 1]!], k - i * 100);
    const [lon, lat] = at([x + 4 * Math.sin(k / 13), y + 4 * Math.cos(k / 17)]);
    return { lon, lat, time: new Date(T0 + k * INTERVAL_MS) };
  });
}

/** Сборка мусора перед замером: базовая линия без чужого мусора; после — без сборки (верхняя оценка пика). */
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

const route = longRoute();
const ride = longRide(route);
const geometry = corridorOf(route);
const window: MatchWindow = {
  startsAt: new Date(T0 - 3_600_000),
  closesAt: new Date(T0 + 3 * 86_400_000),
};

describe('AC14: длинный трек — 200 000 точек на маршруте 200 км', () => {
  it(`matchCorridor ≤ ${TIME_LIMIT_MS} мс и ≤ 64 МБ прироста памяти`, () => {
    expect(geometry.distanceM).toBeGreaterThan(199_000);
    const points = ride;
    collectGarbage();
    const before = process.memoryUsage();
    const startedAt = performance.now();
    const match = matchCorridor(points, prepareCorridor(geometry), window);
    const elapsedMs = performance.now() - startedAt;
    const after = process.memoryUsage();

    expect(match.verdict).toBe('counted');
    expect(match.segment!.coverage).toBe(1);
    expect(elapsedMs).toBeLessThanOrEqual(TIME_LIMIT_MS);
    const grownBytes =
      after.heapUsed + after.arrayBuffers - (before.heapUsed + before.arrayBuffers);
    expect(grownBytes).toBeLessThanOrEqual(MEMORY_LIMIT_BYTES);
    process.stdout.write(
      `matchCorridor 200k: ${Math.round(elapsedMs)} мс, +${Math.round(grownBytes / 1048576)} МБ\n`,
    );
  });

  it('analyzeAttempt в Worker с resourceLimits 160/32 МБ (как поток разбора API)', async () => {
    const stream: TrackStreamV1 = {
      v: 1,
      provider: 'garmin',
      sport: 'road_cycling',
      hasHeartRate: false,
      hasPower: false,
      points: ride.map((p) => [p.time!.getTime(), p.lat, p.lon, null]),
    };
    const bytes = encodeTrackStream(stream);
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.url).then((tracks) => {
        const started = performance.now();
        const result = tracks.analyzeAttempt(
          workerData.bytes, 'stream', workerData.corridor, workerData.window, new Date(workerData.now),
        );
        parentPort.postMessage({ result, ms: performance.now() - started });
      });
    `;
    const outcome = await new Promise<{ result: CorridorMatch; ms: number }>((resolve, reject) => {
      const worker = new Worker(source, {
        eval: true,
        workerData: {
          url: new URL('../parse.ts', import.meta.url).href,
          bytes,
          corridor: geometry,
          window,
          now: T0 + 3 * 86_400_000,
        },
        resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 32 },
      });
      worker.once('message', (message: { result: CorridorMatch; ms: number }) => {
        void worker.terminate();
        resolve(message);
      });
      worker.once('error', reject);
    });
    expect(outcome.result.verdict).toBe('counted');
    process.stdout.write(`analyzeAttempt 200k в Worker: ${Math.round(outcome.ms)} мс\n`);
  }, 30_000);

  it('плотный коридор на пределе (≤ 32 отрезков в ячейке): 200 000 точек ≤ 3 с', () => {
    // «змейка» 66 × 1 км с шагом 90 м: в ячейке 200 м — 32 отрезка, предел (больше коридор отвергает)
    const corners: Xy[] = [[0, 0]];
    for (let i = 0; i < 66; i += 1) {
      const [x, y] = corners[corners.length - 1]!;
      corners.push(
        [x + (i % 2 === 0 ? 1000 : -1000), y],
        [x + (i % 2 === 0 ? 1000 : -1000), y + 90],
      );
    }
    const corridor = prepareCorridor(corridorOf(corners, { widthM: 20 }));
    let densest = 0;
    for (let k = 0; k + 1 < corridor.grid.offsets.length; k += 1) {
      densest = Math.max(densest, corridor.grid.offsets[k + 1]! - corridor.grid.offsets[k]!);
    }
    expect(densest).toBe(CORRIDOR_POLICY.maxSegmentsPerCell);
    const total = polylineLength(corners);
    const points = Array.from({ length: POINTS }, (_, k): ParsedPoint => {
      const [lon, lat] = at(pointAt(corners, (k * total) / POINTS));
      return { lon, lat, time: new Date(T0 + k * INTERVAL_MS) };
    });
    const startedAt = performance.now();
    const match = matchCorridor(points, corridor, window);
    const elapsedMs = performance.now() - startedAt;
    expect(match.verdict).toBe('counted');
    expect(elapsedMs).toBeLessThanOrEqual(TIME_LIMIT_MS);
    process.stdout.write(`плотный коридор (${densest} в ячейке): ${Math.round(elapsedMs)} мс\n`);
  }, 30_000);

  // ревью pass 4: длинные хорды «внутри → внутри» через широкую «змейку» — геометрия хорд на каждом шаге
  it('длинные хорды через analyzeAttempt (поток, 200 000 точек): ≤ 3 с', () => {
    const corners: Xy[] = [[0, 0]];
    for (let i = 0; i < 184; i += 1) {
      const [x, y] = corners[corners.length - 1]!;
      corners.push(
        [x + (i % 2 === 0 ? 1000 : -1000), y],
        [x + (i % 2 === 0 ? 1000 : -1000), y + 90],
      );
    }
    const geometry200 = corridorOf(corners, { widthM: 200 });
    const cycle: Xy[] = [
      [300, 0],
      [950, 0],
      [300, 450],
      [950, 450],
      [600, 900],
    ];
    const stream: TrackStreamV1 = {
      v: 1,
      provider: 'garmin',
      sport: 'road_cycling',
      hasHeartRate: false,
      hasPower: false,
      points: Array.from({ length: POINTS }, (_, k) => {
        const [lon, lat] = at(k === 0 ? [0, 0] : cycle[(k - 1) % cycle.length]!);
        return [T0 + k * INTERVAL_MS, lat, lon, null];
      }),
    };
    const bytes = encodeTrackStream(stream);
    const startedAt = performance.now();
    // средняя скорость ≈ 1300 м/с — трек неправдоподобен (ошибка файла), геометрия хорд не считается
    expect(() =>
      analyzeAttempt(bytes, 'stream', geometry200, window, new Date(T0 + 3 * 86_400_000)),
    ).toThrow(TrackParseError);
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThanOrEqual(TIME_LIMIT_MS);
    process.stdout.write(`длинные хорды (analyzeAttempt): ${Math.round(elapsedMs)} мс\n`);
  }, 60_000);

  // предел бюджета геометрии: хорды 108 м (60 м вдоль, 90 м поперёк проходов узкого плотного коридора) раз в 3,1 с —
  // сглаженный путь ≈ 20 м/с, сумма хорд в бюджете (≤ 2 × сглаженный + 20 м на точку); каждая хорда пересекает
  // промежуток между проходами — точная геометрия на каждом шаге
  it('геометрия хорд на пределе бюджета (узкий плотный коридор): 200 000 точек ≤ 3 с', () => {
    const corners: Xy[] = [[0, 0]];
    for (let i = 0; i < 66; i += 1) {
      const [x, y] = corners[corners.length - 1]!;
      corners.push(
        [x + (i % 2 === 0 ? 1000 : -1000), y],
        [x + (i % 2 === 0 ? 1000 : -1000), y + 90],
      );
    }
    const corridor = prepareCorridor(corridorOf(corners, { widthM: 20 }));
    // старт: из ворот (0, 0) вперёд по первому проходу; дальше «змейкой» по парам соседних проходов
    const points = Array.from({ length: POINTS }, (_, k): ParsedPoint => {
      const m = k - 2;
      const pair = Math.floor(m / 14);
      const i = m % 14;
      const x = pair % 2 === 0 ? 100 + 60 * i : 880 - 60 * i;
      const y = 90 * (pair % 60) + (m % 2) * 90;
      const [lon, lat] = at(k < 2 ? [k * 60, 0] : [x, y]);
      return { lon, lat, time: new Date(T0 + k * 3100) };
    });
    const startedAt = performance.now();
    const match = matchCorridor(points, corridor, window);
    const elapsedMs = performance.now() - startedAt;
    expect(match.candidates).toBe(1);
    // ≈ 50 м вне коридора на каждой хорде — геометрия действительно посчитана
    expect(match.segment!.offCorridorM).toBeGreaterThan(5_000_000);
    expect(match.verdict).toBe('rejected');
    expect(elapsedMs).toBeLessThanOrEqual(TIME_LIMIT_MS);
    process.stdout.write(`геометрия хорд на пределе бюджета: ${Math.round(elapsedMs)} мс\n`);
  }, 60_000);

  // лимит работы точной геометрии: широкий плотный коридор, хорды 650 м раз в 22 с (сглаженная скорость < 30 м/с) —
  // ≈ 1000 отрезков на хорду; после лимита — консервативная оценка, время ограничено
  it('лимит работы геометрии хорд: широкий плотный коридор, 200 000 длинных хорд ≤ 8 с (худший случай)', () => {
    const corners: Xy[] = [[0, 0]];
    for (let i = 0; i < 184; i += 1) {
      const [x, y] = corners[corners.length - 1]!;
      corners.push(
        [x + (i % 2 === 0 ? 1000 : -1000), y],
        [x + (i % 2 === 0 ? 1000 : -1000), y + 90],
      );
    }
    const corridor = prepareCorridor(corridorOf(corners, { widthM: 200 }));
    const cycle: Xy[] = [
      [300, 0],
      [950, 0],
      [300, 450],
      [950, 450],
      [600, 900],
    ];
    const points = Array.from({ length: POINTS }, (_, k): ParsedPoint => {
      const [lon, lat] = at(k === 0 ? [0, 0] : cycle[(k - 1) % cycle.length]!);
      return { lon, lat, time: new Date(T0 + k * 22_000) };
    });
    const startedAt = performance.now();
    const match = matchCorridor(points, corridor, window);
    const elapsedMs = performance.now() - startedAt;
    expect(match.diagnostics.geometryLimited).toBe(true);
    expect(elapsedMs).toBeLessThanOrEqual(ADVERSARIAL_TIME_LIMIT_MS);
    process.stdout.write(`лимит геометрии хорд: ${Math.round(elapsedMs)} мс\n`);
  }, 60_000);

  // ревью pass 8: стоянка у края коридора (синтетика: 52 ч дрожания на пределе лимита работы — бюджет худшего случая) (190 000 точек дрожания ±3 м при d ≈ 49 м) с реальным расходом лимита —
  // короткие хорды считаются точно, вердикт как без лимита
  it('стоянка у края коридора, 190 000 точек через analyzeAttempt — засчитан, сход 0 (худший случай ≤ 8 с)', () => {
    const route: Xy[] = [
      [0, 0],
      [5000, 0],
      [5000, -90],
      [0, -90],
      [0, -180],
      [5000, -180],
      [5000, -1000],
    ];
    const geometry = corridorOf(route);
    const moving = [[-95, 0] as Xy, ...route, [5000, -1100] as Xy];
    const path: ParsedPoint[] = [];
    let t = T0;
    const push = ([x, y]: Xy, dt: number) => {
      const [lon, lat] = at([x, y]);
      path.push({ lon, lat, time: new Date(t) });
      t += dt;
    };
    // проезд 8 м/с до x = 2600, стоянка, затем дальше
    const total = moving.reduce(
      (sum, p, i) =>
        i === 0 ? 0 : sum + Math.hypot(p[0] - moving[i - 1]![0], p[1] - moving[i - 1]![1]),
      0,
    );
    const position = (along: number): Xy => {
      let rest = along;
      for (let i = 1; i < moving.length; i += 1) {
        const [ax, ay] = moving[i - 1]!;
        const [bx, by] = moving[i]!;
        const length = Math.hypot(bx - ax, by - ay);
        if (rest <= length)
          return [ax + ((bx - ax) * rest) / length, ay + ((by - ay) * rest) / length];
        rest -= length;
      }
      return moving[moving.length - 1]!;
    };
    let along = 0;
    for (; along < 95 + 2600; along += 8) push(position(along), 1000);
    for (let k = 0; k < 190_000; k += 1) push([2600 + 3 * (-1) ** k, 49], 250);
    for (; along <= total; along += 8) push(position(along), 1000);
    const bytes = encodeTrackStream({
      v: 1,
      provider: 'garmin',
      sport: 'road_cycling',
      hasHeartRate: false,
      hasPower: false,
      points: path.map((p) => [p.time!.getTime(), p.lat, p.lon, null]),
    });
    const startedAt = performance.now();
    const match = analyzeAttempt(bytes, 'stream', geometry, window, new Date(T0 + 3 * 86_400_000));
    const elapsedMs = performance.now() - startedAt;
    expect(match.reasons).toEqual([]);
    expect(match.segment!.offCorridorM).toBe(0);
    expect(elapsedMs).toBeLessThanOrEqual(ADVERSARIAL_TIME_LIMIT_MS);
    process.stdout.write(`стоянка у края коридора: ${Math.round(elapsedMs)} мс\n`);
  }, 60_000);
});
