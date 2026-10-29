import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { localProjection, type TrackPoint } from './geo.ts';
import { parseGpx } from './gpx.ts';
import { parseKml } from './kml.ts';
import { parseTrackFile } from './parse.ts';
import { sanitizePoints } from './points.ts';
import { simplifyTrack } from './simplify.ts';
import { ROUTE_MAX_POINTS } from './track.ts';

const CENTER = { lat: 53.9, lon: 27.56 };
/** Бюджет стоянки 200k — строгий локально, ×3 на CI (как AC14 `corridor/bench.test.ts`); перебор — ~80 с. */
const PARKED_LIMIT_MS = 2000 * (process.env.CI ? 3 : 1);

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

  it('200 000 точек стоянки (повторы координат — ничьи расстояний) — быстро, как у перебора', () => {
    // проезд 1 км → стоянка: дрожание между двумя позициями в 49 м от дороги → проезд дальше (AC14 maps-02)
    const road = (from: number) => Array.from({ length: 125 }, (_, i) => pointAtM(from + i * 8, 0));
    const points = [
      ...road(-1000),
      ...Array.from({ length: 200_000 }, (_, k) => pointAtM(3 * (-1) ** k, 49)),
      ...road(0),
    ];
    const started = performance.now();
    const result = simplifyTrack(points, 5, 1000);
    const elapsedMs = performance.now() - started;
    process.stdout.write(`simplifyTrack стоянка 200k: ${Math.round(elapsedMs)} мс\n`);
    expect(result[0]).toBe(points[0]);
    expect(result[result.length - 1]).toBe(points[points.length - 1]);
    expect(result.length).toBeLessThan(20);
    expect(elapsedMs).toBeLessThan(PARKED_LIMIT_MS);
  });
});

/** Эталон — прежний перебор (Дуглас — Пекер с полным сканом диапазона и пересчётом на каждом допуске), O(n²). */
function referenceSimplify(
  points: readonly TrackPoint[],
  toleranceM: number,
  maxPoints: number,
): TrackPoint[] {
  const unique = points.filter(
    (p, i) => i === 0 || p.lat !== points[i - 1]!.lat || p.lon !== points[i - 1]!.lon,
  );
  if (unique.length < 2) return [];
  const { kx, ky } = localProjection(unique[0]!.lat);
  const xs = unique.map((p) => p.lon * kx);
  const ys = unique.map((p) => p.lat * ky);
  const distance2 = (i: number, a: number, b: number) => {
    const dx = xs[b]! - xs[a]!;
    const dy = ys[b]! - ys[a]!;
    const px = xs[i]! - xs[a]!;
    const py = ys[i]! - ys[a]!;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) return px * px + py * py;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / length2));
    return (px - t * dx) ** 2 + (py - t * dy) ** 2;
  };
  const last = unique.length - 1;
  let tolerance = Math.max(toleranceM, 0.01);
  for (;;) {
    const keep = new Set([0, last]);
    const stack = [0, last];
    while (stack.length > 0) {
      const end = stack.pop()!;
      const start = stack.pop()!;
      let max = -1;
      let index = -1;
      for (let i = start + 1; i < end; i += 1) {
        const d2 = distance2(i, start, end);
        if (d2 > max) [max, index] = [d2, i];
      }
      if (index >= 0 && max > tolerance * tolerance) {
        keep.add(index);
        stack.push(start, index, index, end);
      }
    }
    let kept = [...keep].sort((a, b) => a - b);
    if (kept.every((i) => xs[i] === xs[0] && ys[i] === ys[0])) {
      let far = 0;
      let farDistance2 = 0;
      for (let i = 0; i <= last; i += 1) {
        const d2 = (xs[i]! - xs[0]!) ** 2 + (ys[i]! - ys[0]!) ** 2;
        if (d2 > farDistance2) [far, farDistance2] = [i, d2];
      }
      kept = far === 0 ? [] : [...kept, far].sort((a, b) => a - b);
    }
    if (kept.length <= Math.max(maxPoints, 3)) return kept.map((i) => unique[i]!);
    tolerance *= 2;
  }
}

/** Детерминированный ГСЧ (mulberry32). */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Метры от CENTER → точка; `quantum` — шаг сетки координат в градусах (как у приёмника GPS). */
const pointAtM = (x: number, y: number, quantum = 0): TrackPoint => {
  const lat = CENTER.lat + y / 111_195;
  const lon = CENTER.lon + x / (111_195 * Math.cos((CENTER.lat * Math.PI) / 180));
  return quantum > 0
    ? { lat: Math.round(lat / quantum) * quantum, lon: Math.round(lon / quantum) * quantum }
    : { lat, lon };
};

/** Проезд со стоянками: случайное блуждание, на стоянке — дрожание по нескольким квантованным позициям. */
function syntheticRide(seed: number, count: number): TrackPoint[] {
  const next = random(seed);
  const quantum = [0, 1e-5, 1e-6][seed % 3]!;
  const points: TrackPoint[] = [];
  let [x, y, heading] = [0, 0, 0];
  while (points.length < count) {
    if (next() < 0.05) {
      const spots = Array.from({ length: 1 + Math.floor(next() * 4) }, () => [
        x + (next() - 0.5) * 8,
        y + (next() - 0.5) * 8,
      ]);
      for (let k = Math.floor(next() * 400); k > 0; k -= 1) {
        const [sx, sy] = spots[Math.floor(next() * spots.length)]!;
        points.push(pointAtM(sx!, sy!, quantum));
      }
    }
    heading += (next() - 0.5) * (next() < 0.1 ? 3 : 0.3);
    x += Math.cos(heading) * 5;
    y += Math.sin(heading) * 5;
    points.push(pointAtM(x + (next() - 0.5) * 2, y + (next() - 0.5) * 2, quantum));
  }
  return points.slice(0, count);
}

/** Сетка: змейка по рядам с одинаковой широтой — ничьи расстояний до хорд. */
function gridRide(rows: number, columns: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      points.push(pointAtM((r % 2 === 0 ? c : columns - 1 - c) * 3, r * 7));
    }
  }
  return points;
}

/** Профили вызовов: линия заезда, линия сверки маршрута, плитка сторис, жёсткий лимит (удвоение допуска). */
const PROFILES: [number, number][] = [
  [5, 1000],
  [1, 20_000],
  [1, 300],
  [5, 50],
];

describe('simplifyTrack = эталонному перебору', () => {
  it('случайные проезды со стоянками, квантование координат', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const points = syntheticRide(seed, 500 + seed * 97);
      for (const [tolerance, max] of PROFILES) {
        expect(simplifyTrack(points, tolerance, max), `seed ${seed}, ${tolerance}/${max}`).toEqual(
          referenceSimplify(points, tolerance, max),
        );
      }
    }
  });

  it('сетка, кольцо, петля из повторов, стоянка в двух точках', () => {
    const parked = [
      ...Array.from({ length: 50 }, (_, i) => pointAtM(i * 8 - 400, 0)),
      ...Array.from({ length: 3000 }, (_, k) => pointAtM(3 * (-1) ** k, 49)),
      ...Array.from({ length: 50 }, (_, i) => pointAtM(i * 8, 0)),
    ];
    const loop = [...ring(300, 50), ...ring(300, 50), ...ring(300, 50)];
    for (const points of [gridRide(40, 60), ring(3000, 500), loop, parked]) {
      for (const [tolerance, max] of [...PROFILES, [2, 10] as [number, number]]) {
        expect(simplifyTrack(points, tolerance, max)).toEqual(
          referenceSimplify(points, tolerance, max),
        );
      }
    }
  });
});

/**
 * Сторож результата на реальных треках и фикстурах коридора: индексы сохранённых точек (sha256) по профилям вызовов.
 * Эталон снят на прежнем переборе; изменился — алгоритм меняет линии (хранимые `activity_tracks`, `corridor-golden`):
 * перезапись `UPDATE_SIMPLIFY_GOLDEN=1 pnpm --filter @pokatim/tracks test` — только с решением в task.md.
 */
it('golden: все фикстуры = эталону', () => {
  const golden = new URL('./__fixtures__/simplify-golden.json', import.meta.url);
  const actual: Record<string, Record<string, { points: number; sha256: string }>> = {};
  for (const dir of ['./__fixtures__/', './__fixtures__/corridor/']) {
    const base = new URL(dir, import.meta.url);
    for (const name of readdirSync(base).sort()) {
      if (!/\.(fit|gpx|kml)$/.test(name)) continue;
      const bytes = new Uint8Array(readFileSync(new URL(name, base)));
      const text = new TextDecoder().decode(bytes);
      let points: TrackPoint[];
      try {
        points = sanitizePoints(
          name.endsWith('.fit')
            ? parseTrackFile(bytes).points
            : name.endsWith('.kml')
              ? parseKml(text, { maxPoints: ROUTE_MAX_POINTS }).points
              : parseGpx(text, { allowRoute: true, maxPoints: ROUTE_MAX_POINTS }).points,
        );
      } catch {
        continue;
      }
      if (points.length < 2) continue;
      const index = new Map(points.map((point, i) => [point, i]));
      actual[`${dir.replace('./__fixtures__/', '')}${name}`] = Object.fromEntries(
        PROFILES.map(([tolerance, max]) => {
          const kept = simplifyTrack(points, tolerance, max).map((p) => index.get(p)!);
          const sha256 = createHash('sha256').update(kept.join(',')).digest('hex');
          return [`${tolerance}/${max}`, { points: kept.length, sha256 }];
        }),
      );
    }
  }
  if (process.env.UPDATE_SIMPLIFY_GOLDEN === '1') {
    writeFileSync(golden, `${JSON.stringify(actual, null, 2)}\n`);
  }
  expect(Object.keys(actual).length).toBeGreaterThan(30);
  expect(actual).toEqual(JSON.parse(readFileSync(golden, 'utf8')));
});
