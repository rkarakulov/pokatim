import { haversineMeters } from './geo.ts';

/*
 * Скраббинг профиля высоты и линии маршрута (routes-04): чистая логика без платформы и i18n — приложение (Expo) и
 * панель (routes-05) переиспользуют её через лёгкий вход пакета. Позиция — доля 0…1 длины линии показа (S6: без
 * координат в профиле — доля дистанции маршрута ↔ та же доля длины линии).
 */

/** Точка в плоских единицах (пиксели вида карты): `[x, y]`. */
export type Planar = readonly [x: number, y: number];
/** Точка профиля высоты: `[дистанция от старта, м; высота, м]` (контракт `CatalogRouteElevation.profile`). */
export type ProfilePoint = readonly [distanceM: number, elevationM: number];

/** Шаг adjustable / стрелок профиля, м (A1). */
export const SCRUB_STEP_M = 1000;
/** Окно уклона, м: ±100 м вокруг точки (S3). */
export const GRADE_WINDOW_M = 200;
/** Допуск «равных расстояний» до двух проходов петли, м (§7): в его пределах выигрывает проход ближе к подсказке. */
export const SCRUB_LOOP_TOLERANCE_M = 15;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Накопленная длина линии `[lon, lat]` по haversine, м: `[0, …, полная длина]`; пустая линия — `[]`. */
export function cumulativeMeters(line: readonly (readonly [number, number])[]): number[] {
  const result: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (i > 0) {
      const [lon0, lat0] = line[i - 1]!;
      const [lon1, lat1] = line[i]!;
      total += haversineMeters({ lon: lon0, lat: lat0 }, { lon: lon1, lat: lat1 });
    }
    result.push(total);
  }
  return result;
}

/**
 * Точка линии на доле `fraction` её длины: `points` — вершины в плоских единицах, `cumulative` — накопленная длина тех
 * же вершин (любые единицы). Бинарный поиск сегмента, линейная интерполяция; доля вне 0…1 — концы; длина 0 — первая
 * точка.
 */
export function pointAtFraction(
  points: readonly Planar[],
  cumulative: readonly number[],
  fraction: number,
): Planar {
  const total = cumulative.at(-1) ?? 0;
  if (points.length < 2 || total <= 0) return points[0] ?? [0, 0];
  const target = clamp01(fraction) * total;
  let low = 0;
  let high = cumulative.length - 1;
  // первый индекс с cumulative[i] ≥ target
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid]! < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return points[0]!;
  const from = cumulative[low - 1]!;
  const span = cumulative[low]! - from;
  const t = span > 0 ? (target - from) / span : 0;
  const [x0, y0] = points[low - 1]!;
  const [x1, y1] = points[low]!;
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

/**
 * Доля линии, ближайшая к `target` (перетаскивание маркера по карте, S2): проекция на каждый сегмент в плоских
 * единицах. Кандидаты — локальные минимумы расстояния вдоль линии (по одному на каждый проход рядом с точкой) не
 * дальше лучшего на `tolerance`; с подсказкой `hint` (текущая доля) — кандидат с долей ближе к ней (петля и
 * «туда-обратно» не прыгают на другой проход), без подсказки — глобальный минимум.
 */
export function nearestFraction(
  points: readonly Planar[],
  cumulative: readonly number[],
  target: Planar,
  hint: number | null,
  tolerance: number,
): number {
  const total = cumulative.at(-1) ?? 0;
  if (points.length < 2 || total <= 0) return 0;
  const count = points.length - 1;
  const distances: number[] = [];
  const fractions: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.min(1, Math.max(0, ((target[0] - x0) * dx + (target[1] - y0) * dy) / lengthSq))
        : 0;
    distances.push(Math.hypot(x0 + dx * t - target[0], y0 + dy * t - target[1]));
    const from = cumulative[i]!;
    fractions.push((from + (cumulative[i + 1]! - from) * t) / total);
  }
  let best = 0;
  for (let i = 1; i < count; i += 1) if (distances[i]! < distances[best]!) best = i;
  if (hint === null) return clamp01(fractions[best]!);
  let chosen = best;
  for (let i = 0; i < count; i += 1) {
    const local =
      (i === 0 || distances[i]! <= distances[i - 1]!) &&
      (i === count - 1 || distances[i]! <= distances[i + 1]!);
    if (
      local &&
      distances[i]! <= distances[best]! + tolerance &&
      Math.abs(fractions[i]! - hint) < Math.abs(fractions[chosen]! - hint)
    ) {
      chosen = i;
    }
  }
  return clamp01(fractions[chosen]!);
}

/** Высота профиля на дистанции `d`, м: линейная интерполяция, за краями — края; пустой профиль — 0. */
export function elevationAt(profile: readonly ProfilePoint[], d: number): number {
  if (profile.length === 0) return 0;
  if (d <= profile[0]![0]) return profile[0]![1];
  const last = profile.at(-1)!;
  if (d >= last[0]) return last[1];
  let low = 0;
  let high = profile.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (profile[mid]![0] < d) low = mid + 1;
    else high = mid;
  }
  const [d0, e0] = profile[low - 1]!;
  const [d1, e1] = profile[low]!;
  return d1 > d0 ? e0 + ((e1 - e0) * (d - d0)) / (d1 - d0) : e1;
}

/**
 * Уклон на дистанции `d`, целый % (S3, RC-10): `(e(b) − e(a)) / (b − a)` по окну `max(200 м, шаг профиля)` с центром в
 * `d`; у краёв окно сдвигается внутрь. Спуск — отрицательный, «−0» — 0.
 */
export function gradeAt(profile: readonly ProfilePoint[], d: number): number {
  if (profile.length < 2) return 0;
  const start = profile[0]![0];
  const end = profile.at(-1)![0];
  const length = end - start;
  if (length <= 0) return 0;
  const window = Math.min(length, Math.max(GRADE_WINDOW_M, length / (profile.length - 1)));
  let a = d - window / 2;
  let b = d + window / 2;
  if (a < start) {
    a = start;
    b = start + window;
  } else if (b > end) {
    b = end;
    a = end - window;
  }
  const grade = Math.round(((elevationAt(profile, b) - elevationAt(profile, a)) / (b - a)) * 100);
  return grade === 0 ? 0 : grade;
}

/** Сумма подъёмов профиля от старта до `d`, м (последний сегмент — до интерполированной точки). */
function rawGain(profile: readonly ProfilePoint[], d: number): number {
  let gain = 0;
  for (let i = 1; i < profile.length; i += 1) {
    const [d0, e0] = profile[i - 1]!;
    const [d1] = profile[i]!;
    if (d0 >= d) break;
    const e1 = d1 <= d ? profile[i]![1] : elevationAt(profile, d);
    if (e1 > e0) gain += e1 - e0;
  }
  return gain;
}

/**
 * Набор от старта до `d`, целые м (RC-9): подъёмы профиля, масштабированные так, что на финише набор равен набору
 * сервера `totalGainM` (профиль прорежен и теряет мелкие подъёмы); `null` или подъёмов в профиле нет — сырой.
 */
export function gainTo(
  profile: readonly ProfilePoint[],
  d: number,
  totalGainM: number | null,
): number {
  const raw = rawGain(profile, d);
  const rawTotal = rawGain(profile, profile.at(-1)?.[0] ?? 0);
  if (totalGainM === null || rawTotal <= 0) return Math.round(raw);
  return Math.round((raw * totalGainM) / rawTotal);
}

/** Погрешность доли при пересчёте в метры (1000,0000001 м — это 1 км). */
const STEP_EPSILON = 1e-6;

/**
 * Шаг adjustable / стрелок (RC-10): вперёд — к следующему целому км, назад — к предыдущему (с нецелого — к целому
 * ниже); границы 0 и `distanceM` (последний шаг — до `distanceM`, не целого км).
 */
export function stepDistance(d: number, distanceM: number, direction: 1 | -1): number {
  const km = d / SCRUB_STEP_M;
  const next =
    direction === 1
      ? (Math.floor(km + STEP_EPSILON) + 1) * SCRUB_STEP_M
      : (Math.ceil(km - STEP_EPSILON) - 1) * SCRUB_STEP_M;
  return Math.min(distanceM, Math.max(0, next));
}

/** Нижняя граница высоты графика, доля: самая низкая точка профиля не пропадает. */
export const PROFILE_FLOOR = 0.08;

/** Высоты графика, доля 0…1: мин. профиля — `PROFILE_FLOOR`, макс. — 1; ровный профиль — середина. */
export function profileHeights(values: readonly number[], minM: number, maxM: number): number[] {
  if (maxM <= minM) return values.map(() => 0.5);
  return values.map(
    (value) => PROFILE_FLOOR + ((1 - PROFILE_FLOOR) * (value - minM)) / (maxM - minM),
  );
}

/**
 * Точки линии профиля: `[x, y]` в долях 0…1 — X по дистанции (последняя точка — 1), Y — высота от низа
 * (`profileHeights`). Меньше двух точек или нулевая длина — `[]`.
 */
export function profilePoints(
  profile: readonly ProfilePoint[],
  minM: number,
  maxM: number,
): [number, number][] {
  const total = profile.at(-1)?.[0] ?? 0;
  if (profile.length < 2 || total <= 0) return [];
  const heights = profileHeights(
    profile.map(([, elevation]) => elevation),
    minM,
    maxM,
  );
  return profile.map(([distance], index) => [distance / total, heights[index]!]);
}
