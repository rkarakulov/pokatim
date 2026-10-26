// Синтетические фикстуры сверки с коридором (`matchCorridor`): маршруты и заезды у центра Минска, GPX 1.1, время
// UTC, без персональных данных. Детерминированно: псевдошум — mulberry32 с фиксированным зерном.
// Запуск из корня репо: pnpm exec node packages/tracks/scripts/generate-corridor-fixtures.ts
// Эталоны (`corridor-expected.json`) считаются здесь по построению — известные путь, скорость и смещения от
// маршрута, длины — в локальной плоскости; пакет не вызывается. Длинный трек (200 000 точек) — в памяти теста.
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../src/__fixtures__/corridor/', import.meta.url);
const ENGINE_VERSION = 1;
const CENTER = { lat: 53.9006, lon: 27.559 };
const START = Date.UTC(2026, 5, 14, 6, 0, 0); // 14.06.2026 09:00 по Минску
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
const WIDTH_M = 50;
const GATE_M = 50;
const LEAD_IN_M = 95;

type Xy = [number, number];

interface Sample {
  x: number;
  y: number;
  /** мс */
  t: number;
  /** пройденное по пути (без шума), м */
  along: number;
  outlier?: boolean;
}

/** mulberry32 — детерминированный псевдослучайный поток [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function length(path: readonly Xy[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  }
  return total;
}

/** Позиция и единичное направление пути на расстоянии `along`. */
function locate(
  path: readonly Xy[],
  along: number,
): { x: number; y: number; dx: number; dy: number } {
  let rest = along;
  for (let i = 1; i < path.length; i += 1) {
    const [ax, ay] = path[i - 1]!;
    const [bx, by] = path[i]!;
    const segment = Math.hypot(bx - ax, by - ay);
    if (segment === 0) continue;
    if (rest <= segment + 1e-9 || i === path.length - 1) {
      const u = rest / segment;
      return {
        x: ax + (bx - ax) * u,
        y: ay + (by - ay) * u,
        dx: (bx - ax) / segment,
        dy: (by - ay) / segment,
      };
    }
    rest -= segment;
  }
  throw new Error('empty path');
}

/** Скорость по участкам пути: `[до along, м/с]`, последняя — до конца. */
type SpeedProfile = [number, number][];

function alongAt(profile: SpeedProfile, seconds: number): number {
  let along = 0;
  let time = 0;
  for (const [until, speed] of profile) {
    const span = (until - along) / speed;
    if (seconds <= time + span) return along + (seconds - time) * speed;
    time += span;
    along = until;
  }
  return along;
}

function timeAt(profile: SpeedProfile, along: number): number {
  let from = 0;
  let time = 0;
  for (const [until, speed] of profile) {
    if (along <= until) return time + (along - from) / speed;
    time += (until - from) / speed;
    from = until;
  }
  throw new Error('along beyond profile');
}

interface RideOptions {
  speed: number | SpeedProfile;
  intervalS?: number;
  startMs?: number;
  /** боковое смещение (влево по ходу) по `along` */
  lateral?: (along: number) => number;
}

function profileOf(path: readonly Xy[], speed: number | SpeedProfile): SpeedProfile {
  return typeof speed === 'number' ? [[length(path), speed]] : speed;
}

function sampleRide(path: readonly Xy[], options: RideOptions): Sample[] {
  const profile = profileOf(path, options.speed);
  const total = length(path);
  const interval = options.intervalS ?? 1;
  const startMs = options.startMs ?? START;
  const samples: Sample[] = [];
  for (let k = 0; ; k += 1) {
    const along = alongAt(profile, k * interval);
    if (along > total + 1e-9) break;
    const at = locate(path, along);
    const side = options.lateral?.(Math.round(along * 1000) / 1000) ?? 0;
    samples.push({
      x: at.x - at.dy * side,
      y: at.y + at.dx * side,
      t: startMs + k * interval * 1000,
      along,
    });
    if (along >= total - 1e-9) break;
  }
  return samples;
}

/** Явные позиции раз в секунду. */
function explicitRide(positions: readonly Xy[], startMs = START): Sample[] {
  let along = 0;
  return positions.map((xy, k) => {
    if (k > 0) along += Math.hypot(xy[0] - positions[k - 1]![0], xy[1] - positions[k - 1]![1]);
    return { x: xy[0], y: xy[1], t: startMs + k * 1000, along };
  });
}

/** Коррелированный шум GPS (AR(1), ρ = 0.995) со стационарным σ, модуль ограничен `clip`·σ. */
function addNoise(samples: Sample[], sigma: number, seed: number, clip = 3): void {
  const random = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const rho = 0.995;
  const innovation = sigma * Math.sqrt(1 - rho * rho);
  let nx = gauss() * sigma;
  let ny = gauss() * sigma;
  for (const sample of samples) {
    nx = rho * nx + innovation * gauss();
    ny = rho * ny + innovation * gauss();
    const magnitude = Math.hypot(nx, ny);
    const scale = magnitude > clip * sigma ? (clip * sigma) / magnitude : 1;
    sample.x += nx * scale;
    sample.y += ny * scale;
  }
}

const steps = (from: number, to: number, step: number): number[] => {
  const result: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) result.push(v);
  return result;
};

// --- вывод ---

const toLonLat = ([x, y]: Xy): [number, number] => [
  Number((CENTER.lon + x / M_PER_DEG_LON).toFixed(8)),
  Number((CENTER.lat + y / M_PER_DEG_LAT).toFixed(8)),
];
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

function gpx(samples: readonly Sample[]): string {
  const points = samples
    .map((s) => {
      const [lon, lat] = toLonLat([s.x, s.y]);
      return `      <trkpt lat="${lat.toFixed(8)}" lon="${lon.toFixed(8)}"><time>${iso(s.t)}</time></trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pokatim corridor fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${iso(samples[0]!.t)}</time></metadata>
  <trk>
    <name>Синтетический заезд</name>
    <type>cycling</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

interface Expected {
  verdict: 'counted' | 'rejected';
  reasons: string[];
  touchedCorridor: boolean;
  elapsedSec?: number;
  toleranceSec?: number;
  startedAt?: string;
  finishedAt?: string;
  momentToleranceMs?: number;
  coverage?: number;
  offCorridorShare?: number;
  /** допуск доли схода: у шумной фикстуры границы сегмента (ворота) сдвинуты шумом */
  offShareTolerance?: number;
  maxExcursionM?: number;
  noisePoints?: number;
}

const fixtures: Record<string, unknown> = {};
const WIDE_WINDOW = { startsAt: iso(START - 3_600_000), closesAt: iso(START + 7 * 86_400_000) };

function corridor(line: readonly Xy[], isLoop: boolean) {
  return { line: line.map(toLonLat), widthM: WIDTH_M, isLoop, distanceM: length(line) };
}

function emit(
  name: string,
  samples: Sample[],
  route: { line: readonly Xy[]; isLoop: boolean },
  expected: Expected,
  window = WIDE_WINDOW,
): void {
  writeFileSync(new URL(name, OUT), gpx(samples));
  fixtures[name] = { corridor: corridor(route.line, route.isLoop), window, expected };
}

/**
 * Эталон засчитанного проезда: моменты ворот — по профилю скорости (`startAlong`, `finishAlong` на пути), длина
 * трека и сход — по хордам между точками (как пишет трек), с долями крайних шагов; отклонение точки — расстояние
 * до ломаной маршрута; правило схода — A6: момент ворот — точка коридора, выход завершается точкой внутри.
 */
/** Расстояние от точки до ломаной маршрута в локальной плоскости, м. */
function distanceToRoute(x: number, y: number, line: readonly Xy[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1]!;
    const dx = line[i]![0] - ax;
    const dy = line[i]![1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

function counted(
  line: readonly Xy[],
  samples: readonly Sample[],
  profile: SpeedProfile,
  startAlong: number,
  finishAlong: number,
  extra: Partial<Expected> & { toleranceSec?: number; momentToleranceMs?: number } = {},
  startMs = START,
): Expected {
  const startedMs = startMs + timeAt(profile, startAlong) * 1000;
  const finishedMs = startMs + timeAt(profile, finishAlong) * 1000;
  const kept = samples.filter((s) => s.outlier !== true);
  let distance = 0;
  let off = 0;
  let excursion = 0;
  let maxExcursion = 0;
  for (let k = 1; k < kept.length; k += 1) {
    const a = kept[k - 1]!;
    const b = kept[k]!;
    if (b.along <= startAlong || a.along >= finishAlong) continue;
    const from = a.along < startAlong ? (startAlong - a.along) / (b.along - a.along) : 0;
    const to = b.along > finishAlong ? (finishAlong - a.along) / (b.along - a.along) : 1;
    const chord = Math.hypot(b.x - a.x, b.y - a.y) * (to - from);
    distance += chord;
    const fromInside = from > 0 || distanceToRoute(a.x, a.y, line) <= WIDTH_M;
    const toInside = to < 1 || distanceToRoute(b.x, b.y, line) <= WIDTH_M;
    const outside = (fromInside ? 0 : 1) + (toInside ? 0 : 1);
    if (outside > 0) {
      const part = outside === 2 ? chord : chord / 2;
      off += part;
      excursion = fromInside ? part : excursion + part;
      maxExcursion = Math.max(maxExcursion, excursion);
    }
    if (toInside) excursion = 0;
  }
  const distanceM = Math.round(distance);
  const offM = Math.round(off);
  return {
    verdict: 'counted',
    reasons: [],
    touchedCorridor: true,
    elapsedSec: Math.round((Math.round(finishedMs) - Math.round(startedMs)) / 1000),
    toleranceSec: 1,
    startedAt: new Date(Math.round(startedMs)).toISOString(),
    finishedAt: new Date(Math.round(finishedMs)).toISOString(),
    momentToleranceMs: 1000,
    coverage: 1,
    offCorridorShare: offM / distanceM,
    maxExcursionM: Math.round(maxExcursion),
    noisePoints: kept.length === samples.length ? 0 : samples.length - kept.length,
    ...extra,
  };
}

const rejected = (reasons: string[], touchedCorridor = true): Expected => ({
  verdict: 'rejected',
  reasons,
  touchedCorridor,
});

mkdirSync(OUT, { recursive: true });

// --- Маршрут A: линейный 8 км («Г»: 3 км на восток, 5 км на север), коридор ±50 м ---
const A = {
  line: [
    [0, 0],
    [3000, 0],
    [3000, 5000],
  ] as Xy[],
  isLoop: false,
};
const A_PATH: Xy[] = [
  [-LEAD_IN_M, 0],
  [0, 0],
  [3000, 0],
  [3000, 5000],
  [3000, 5300],
];
const A_START = LEAD_IN_M + GATE_M; // 145 м пути — выход из ворот старта
const A_FINISH = LEAD_IN_M + 8000 - GATE_M; // 8045 м пути — вход в ворота финиша
const v10: SpeedProfile = [[length(A_PATH), 10]];

{
  const samples = sampleRide(A_PATH, { speed: 10 });
  addNoise(samples, 3, 1);
  emit(
    'clean.gpx',
    samples,
    A,
    counted(A.line, samples, v10, A_START, A_FINISH, { maxExcursionM: 0 }),
  );
}

/** Боковые сходы по 65 м: смещения точек 23 → 47 → 70 ×5 → 47 → 23 м (пять точек вне коридора ±50 м). */
function wobbles(centers: number[]): (along: number) => number {
  const profile = [23, 47, 70, 70, 70, 70, 70, 47, 23];
  return (along) => {
    for (const center of centers) {
      const i = Math.round((along - center) / 10) + 4;
      if (Math.abs(along - center - (i - 4) * 10) < 1e-6 && i >= 0 && i < profile.length) {
        return profile[i]!;
      }
    }
    return 0;
  };
}
for (const [name, centers] of [
  ['wobble-3pct.gpx', [1000, 1800, 2400, 4500]],
  ['wobble-1_5pct.gpx', [1000, 4500]],
] as const) {
  const samples = sampleRide(A_PATH, { speed: 10, lateral: wobbles([...centers]) });
  const expected = counted(A.line, samples, v10, A_START, A_FINISH);
  const { offCorridorShare, maxExcursionM } = expected;
  emit(
    name,
    samples,
    A,
    offCorridorShare! > 0.02
      ? { ...rejected(['off_corridor']), offCorridorShare, maxExcursionM }
      : expected,
  );
}

{
  const samples = sampleRide(A_PATH, { speed: 10 });
  // хвост шума до 5σ = 75 м: при этом зерне 5 точек уходят за коридор ±50 м (на 2,7 м)
  addNoise(samples, 15, 37, 5);
  // 5 одиночных выбросов на 300 м в сторону (многолучёвость у зданий)
  for (const index of [150, 300, 450, 600, 750]) {
    const s = samples[index]!;
    samples[index] = {
      ...s,
      y: s.x < 3000 ? s.y + 300 : s.y,
      x: s.x < 3000 ? s.x : s.x + 300,
      outlier: true,
    };
  }
  emit(
    'noisy.gpx',
    samples,
    A,
    // моменты ворот — по пути без шума; шум у ворот до 75 м при 10 м/с сдвигает их до ≈ 7,5 с
    counted(A.line, samples, v10, A_START, A_FINISH, {
      toleranceSec: 8,
      momentToleranceMs: 8000,
      offShareTolerance: 0.003,
    }),
  );
}

// Редкая запись (решение автора 2026-10-27): недобранный путь хорды — сход на каждом шаге. Прямая 8 км раз в
// 30–60 с — засчитана (хорда = путь); извилистая дорога раз в 30 с — `sparse_recording`.
const STRAIGHT = {
  line: [
    [0, 0],
    [8000, 0],
  ] as Xy[],
  isLoop: false,
};
{
  const path: Xy[] = [
    [-LEAD_IN_M, 0],
    [8800, 0],
  ];
  const samples = sampleRide(path, { speed: 10, intervalS: 30 });
  emit(
    'sparse-30s.gpx',
    samples,
    STRAIGHT,
    counted(STRAIGHT.line, samples, [[length(path), 10]], A_START, A_FINISH, { toleranceSec: 5 }),
  );
}
{
  const path: Xy[] = [
    [-LEAD_IN_M, 0],
    [9000, 0],
  ];
  const speed = 40 / 3.6;
  const samples = sampleRide(path, { speed, intervalS: 60 });
  emit(
    'sparse-60s.gpx',
    samples,
    STRAIGHT,
    counted(STRAIGHT.line, samples, [[length(path), speed]], A_START, A_FINISH, {
      toleranceSec: 5,
    }),
  );
}
{
  // y = 25·sin(x/30): путь на ≈ 17 % длиннее хорды 300 м, хорды остаются в коридоре ±50 м
  const winding = steps(0, 6000, 5).map((x): Xy => [x, 25 * Math.sin(x / 30)]);
  const samples = sampleRide([[-LEAD_IN_M, 0], ...winding, [6200, 25 * Math.sin(200)]], {
    speed: 10,
    intervalS: 30,
  });
  emit(
    'sparse-winding-30s.gpx',
    samples,
    { line: winding, isLoop: false },
    rejected(['sparse_recording']),
  );
}

{
  // 3 км без точек в середине (путь 2595…5595 м — маршрут 2500…5500 м)
  const samples = sampleRide(A_PATH, { speed: 10 }).filter(
    (s) => s.along <= 2595 || s.along >= 5595,
  );
  emit('gap-3km.gpx', samples, A, rejected(['gps_gap']));
}
{
  // тоннель: 600 м без точек на прямой
  const samples = sampleRide(A_PATH, { speed: 10 }).filter(
    (s) => s.along <= 1095 || s.along >= 1695,
  );
  emit('tunnel-600m.gpx', samples, A, counted(A.line, samples, v10, A_START, A_FINISH));
}

// окно: старт 14,5 с, финиш 804,5 с от начала записи; день — свой у каждой фикстуры
for (const [index, [name, window, verdict]] of (
  [
    [
      'window-start-before.gpx',
      (s: number, f: number): [number, number] => [s + 1000, f + 3_600_000],
      'outside_window',
    ],
    [
      'window-finish-at-close.gpx',
      (s: number, f: number): [number, number] => [s - 60_000, f],
      'outside_window',
    ],
    [
      'window-finish-before-close.gpx',
      (s: number, f: number): [number, number] => [s - 60_000, f + 1000],
      'counted',
    ],
    [
      'window-record-before.gpx',
      (s: number, f: number): [number, number] => [s - 9500, f + 3_600_000],
      'counted',
    ],
  ] as const
).entries()) {
  const startMs = START + (index + 1) * 86_400_000;
  const samples = sampleRide(A_PATH, { speed: 10, startMs });
  const expected = counted(
    A.line,
    samples,
    v10,
    A_START,
    A_FINISH,
    { toleranceSec: 0, momentToleranceMs: 1 },
    startMs,
  );
  const [startsAt, closesAt] = window(
    Date.parse(expected.startedAt!),
    Date.parse(expected.finishedAt!),
  );
  emit(name, samples, A, verdict === 'counted' ? expected : rejected(['outside_window']), {
    startsAt: new Date(startsAt).toISOString(),
    closesAt: new Date(closesAt).toISOString(),
  });
}

{
  const samples = sampleRide(A_PATH, { speed: 10, intervalS: 10 });
  emit(
    'gates-10s.gpx',
    samples,
    A,
    counted(A.line, samples, v10, A_START, A_FINISH, { toleranceSec: 0, momentToleranceMs: 500 }),
  );
}

emit(
  'mid-start.gpx',
  sampleRide(
    [
      [3000, 0],
      [3000, 5300],
    ],
    { speed: 10 },
  ),
  A,
  rejected(['no_start']),
);
emit(
  'stop-80pct.gpx',
  sampleRide(
    [
      [-LEAD_IN_M, 0],
      [0, 0],
      [3000, 0],
      [3000, 3400],
    ],
    { speed: 10 },
  ),
  A,
  rejected(['no_finish']),
);
emit(
  'far-away.gpx',
  sampleRide(
    [
      [-LEAD_IN_M, -2000],
      [3000, -2000],
      [3000, -5000],
    ],
    { speed: 10 },
  ),
  A,
  rejected(['no_start'], false),
);
emit(
  'reverse-linear.gpx',
  sampleRide(
    [
      [3000, 5300],
      [3000, 0],
      [0, 0],
      [-LEAD_IN_M, 0],
    ],
    { speed: 10 },
  ),
  A,
  rejected(['wrong_direction']),
);

// --- Маршрут S: прямая 27 км на восток; срез — выход на север (меридиан) и возврат ---
const S = {
  line: [
    [0, 0],
    [27_000, 0],
  ] as Xy[],
  isLoop: false,
};
/** Вне коридора по построению: 2 × (depth − 50) м — полшага 45 → 55 м, хорды до вершины и обратно. */
function spur(depth: number): Xy[] {
  const junction = 13_505;
  const along = (xs: number[]): Xy[] => xs.map((x) => [x, 0]);
  const up = steps(5, depth - 1, 10);
  return [
    ...along(steps(-LEAD_IN_M, junction, 10)),
    ...[...up, depth, ...up.reverse()].map((y): Xy => [junction, y]),
    ...along(steps(junction, 27_195, 10)),
  ];
}
for (const [name, depth] of [
  ['shortcut-800.gpx', 450],
  ['shortcut-450.gpx', 275],
  ['shortcut-500.gpx', 300],
] as const) {
  const positions = spur(depth);
  const samples = explicitRide(positions);
  const finishAlong = samples.find((s) => s.x === 26_945)!.along + 5;
  const startAlong = LEAD_IN_M + GATE_M;
  // 1 точка в секунду: на прямой — 10 м/с (старт по профилю), на срезе шаг 5–10 м — финиш по точке перед воротами
  const expected = counted(
    S.line,
    samples,
    [[samples[samples.length - 1]!.along, 10]],
    startAlong,
    finishAlong,
  );
  const finishedMs = samples.find((s) => s.x === 26_945)!.t + 500;
  Object.assign(expected, {
    finishedAt: new Date(finishedMs).toISOString(),
    elapsedSec: Math.round((finishedMs - Date.parse(expected.startedAt!)) / 1000),
  });
  const { offCorridorShare, maxExcursionM } = expected;
  emit(
    name,
    samples,
    S,
    maxExcursionM! > 500
      ? { ...rejected(['off_corridor']), offCorridorShare, maxExcursionM }
      : expected,
  );
}

// --- Маршрут B: петля — квадрат 1,5 км, старт = финиш ---
const LOOP: Xy[] = [
  [0, 0],
  [0, 1500],
  [1500, 1500],
  [1500, 0],
  [0, 0],
];
const B = { line: LOOP, isLoop: true };
{
  const path: Xy[] = [[0, -LEAD_IN_M], ...LOOP, [-LEAD_IN_M, 0]];
  const samples = sampleRide(path, { speed: 8 });
  emit('loop-1lap.gpx', samples, B, counted(B.line, samples, [[length(path), 8]], 145, 6045));
}
{
  const path: Xy[] = [[0, -LEAD_IN_M], ...LOOP, ...LOOP.slice(1), [-LEAD_IN_M, 0]];
  const profile: SpeedProfile = [
    [LEAD_IN_M + 6000, 8],
    [length(path), 9],
  ];
  const samples = sampleRide(path, { speed: profile });
  // лучший — второй круг (9 м/с): выход 6145 м, вход 12 045 м пути
  emit('loop-2laps.gpx', samples, B, counted(B.line, samples, profile, 6145, 12_045));
}
{
  // три выхода из ворот вперёд с возвратом (каждые ≈ 25 с) — старт = последний выход
  const path: Xy[] = [
    [0, -LEAD_IN_M],
    [0, 70],
    [0, -30],
    [0, 70],
    [0, -30],
    ...LOOP,
    [-LEAD_IN_M, 0],
  ];
  const samples = sampleRide(path, { speed: 8 });
  emit('loop-loiter.gpx', samples, B, counted(B.line, samples, [[length(path), 8]], 545, 6445));
}
emit(
  'reverse-loop.gpx',
  sampleRide([[-LEAD_IN_M, 0], ...[...LOOP].reverse(), [0, -LEAD_IN_M]], { speed: 8 }),
  B,
  rejected(['wrong_direction']),
);

// --- Маршрут C: «туда-обратно» 10 км по одной дороге (меридиан) ---
const C = {
  line: [
    [0, 0],
    [0, 10_000],
    [0, 0],
  ] as Xy[],
  isLoop: true,
};
{
  const path: Xy[] = [
    [0, -LEAD_IN_M],
    [0, 10_000],
    [0, 0],
    [-LEAD_IN_M, 0],
  ];
  const samples = sampleRide(path, { speed: 10 });
  emit('outback-full.gpx', samples, C, counted(C.line, samples, [[length(path), 10]], 145, 20_045));
}
emit(
  'outback-turn-7km.gpx',
  sampleRide(
    [
      [0, -LEAD_IN_M],
      [0, 7000],
      [0, 0],
      [-LEAD_IN_M, 0],
    ],
    { speed: 10 },
  ),
  C,
  // обратный путь — скачок на встречную ветку (Витерби): 6 км маршрута не пройдены — и сход
  rejected(['missed_section', 'off_corridor']),
);

// раскладка prettier: короткие массивы значений — в одну строку (`prettier --check` не трогает эталон)
const json = JSON.stringify({ engineVersion: ENGINE_VERSION, fixtures }, null, 2).replace(
  /\[\n([^[\]{}]*?)\n\s*\]/g,
  (_, items: string) =>
    `[${items
      .trim()
      .split(/,\n\s*/)
      .join(', ')}]`,
);
writeFileSync(new URL('corridor-expected.json', OUT), `${json}\n`);
process.stdout.write(`corridor fixtures: ${Object.keys(fixtures).length}\n`);
