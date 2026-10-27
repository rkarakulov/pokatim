import { haversineMeters, type TrackPoint } from './geo.ts';

/** Предел точек профиля высоты маршрута. */
export const ROUTE_PROFILE_MAX_POINTS = 300;
/** Наименьший шаг профиля по дистанции, м. */
export const ROUTE_PROFILE_MIN_STEP_M = 25;

/**
 * Профиль высоты маршрута (routes-03): `[distanceM, elevationM]` (целые) на равных шагах по дистанции.
 * `n = clamp(floor(D / 25) + 1, 2, 300)`, `d_k = round(D · k / (n − 1))` — концы `0` и `D` (та же сумма haversine,
 * что длина маршрута). Высота точки ряда — среднее высот исходных точек в окне шага `[d_k − h/2, d_k + h/2]`;
 * пустое окно — линейная интерполяция по дистанции между ближайшими точками с высотой, за краями — ближайшая высота.
 * Окно шага (≥ 25 м) гасит всплески GPS — дополнительного сглаживания нет. Нет ни одной конечной высоты — `null`
 * (то же условие, что `elevationGainM === null`).
 */
export function elevationProfile(points: readonly TrackPoint[]): [number, number][] | null {
  // дистанции и высоты точек с конечной `ele` (по возрастанию дистанции)
  const eleDist: number[] = [];
  const eleValue: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) total += haversineMeters(points[i - 1]!, points[i]!);
    const ele = points[i]!.ele;
    if (ele !== undefined && Number.isFinite(ele)) {
      eleDist.push(total);
      eleValue.push(ele);
    }
  }
  if (eleDist.length === 0) return null;

  // префиксные суммы высот — среднее окна за O(log n)
  const prefix = new Float64Array(eleValue.length + 1);
  for (let i = 0; i < eleValue.length; i += 1) prefix[i + 1] = prefix[i]! + eleValue[i]!;

  const n = Math.min(
    Math.max(Math.floor(total / ROUTE_PROFILE_MIN_STEP_M) + 1, 2),
    ROUTE_PROFILE_MAX_POINTS,
  );
  const half = total / (n - 1) / 2;
  const profile: [number, number][] = [];
  for (let k = 0; k < n; k += 1) {
    const at = (total * k) / (n - 1);
    const from = lowerBound(eleDist, at - half);
    const to = upperBound(eleDist, at + half);
    const elevation =
      to > from ? (prefix[to]! - prefix[from]!) / (to - from) : interpolate(eleDist, eleValue, at);
    profile.push([Math.round(at), Math.round(elevation)]);
  }
  return profile;
}

/** Первый индекс с `values[i] >= x`. */
function lowerBound(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Первый индекс с `values[i] > x`. */
function upperBound(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function interpolate(dist: readonly number[], value: readonly number[], at: number): number {
  const right = lowerBound(dist, at);
  if (right === 0) return value[0]!;
  if (right === dist.length) return value[value.length - 1]!;
  const d0 = dist[right - 1]!;
  const d1 = dist[right]!;
  const v0 = value[right - 1]!;
  const v1 = value[right]!;
  return d1 === d0 ? v1 : v0 + ((v1 - v0) * (at - d0)) / (d1 - d0);
}
