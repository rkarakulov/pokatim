import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import { analyzeAttempt, encodeTrackStream, type TrackStreamV1 } from '../parse.ts';
import type { ParsedPoint } from '../track.ts';
import { at, corridorOf, pointAt, polylineLength, T0, type Xy } from './__testing__/synthetic.ts';
import { matchCorridor } from './match.ts';
import { CORRIDOR_POLICY } from './policy.ts';
import { prepareCorridor } from './prepare.ts';
import type { CorridorMatch, MatchWindow } from './types.ts';

const POINTS = 200_000;
const INTERVAL_MS = 500;
const TIME_LIMIT_MS = 3000;
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

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
    const match = analyzeAttempt(
      bytes,
      'stream',
      geometry200,
      window,
      new Date(T0 + 3 * 86_400_000),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(match.verdict).toBe('rejected');
    expect(elapsedMs).toBeLessThanOrEqual(TIME_LIMIT_MS);
    process.stdout.write(`длинные хорды (analyzeAttempt): ${Math.round(elapsedMs)} мс\n`);
  }, 60_000);
});
