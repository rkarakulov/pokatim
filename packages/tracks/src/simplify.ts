import { FarthestPoint } from './farthest-point.ts';
import { localProjection, type TrackPoint } from './geo.ts';

/**
 * Упрощение линии (Дуглас — Пекер, итеративно — без рекурсии на 200 000 точек). Концы сохраняются.
 * Если точек больше `maxPoints`, допуск удваивается до попадания в лимит.
 * Результат — ≥ 2 различных точек или `[]` (вырожденную линию `2dsphere` не примет).
 * Расстояния — в локальной равнопромежуточной проекции вокруг первой точки (погрешность на масштабе заезда мала).
 */
export function simplifyTrack(
  points: readonly TrackPoint[],
  toleranceM: number,
  maxPoints: number,
): TrackPoint[] {
  const unique = dropConsecutiveDuplicates(points);
  if (unique.length < 2) return [];

  const { kx, ky } = localProjection(unique[0]!.lat);
  const xs = new Float64Array(unique.length);
  const ys = new Float64Array(unique.length);
  for (let i = 0; i < unique.length; i += 1) {
    xs[i] = unique[i]!.lon * kx;
    ys[i] = unique[i]!.lat * ky;
  }

  const last = unique.length - 1;
  const limit = Math.max(maxPoints, 3);
  let tolerance = Math.max(toleranceM, 0.01);
  const significance = douglasPeucker(xs, ys, tolerance * tolerance);
  for (;;) {
    const tolerance2 = tolerance * tolerance;
    const kept: number[] = [];
    for (let i = 0; i <= last; i += 1) {
      if (i === 0 || i === last || significance[i]! > tolerance2) kept.push(i);
    }
    const result = ensureTwoDistinct(kept, xs, ys);
    if (result.length <= limit) return result.map((index) => unique[index]!);
    tolerance *= 2;
  }
}

function dropConsecutiveDuplicates(points: readonly TrackPoint[]): TrackPoint[] {
  const result: TrackPoint[] = [];
  for (const point of points) {
    const prev = result[result.length - 1];
    if (prev === undefined || prev.lat !== point.lat || prev.lon !== point.lon) result.push(point);
  }
  return result;
}

/**
 * Дерево делений Дугласа — Пекера при допуске `tolerance2` (квадрат). Дальняя точка диапазона от допуска не зависит,
 * поэтому при большем допуске сохраняется часть того же дерева: точка `i` сохраняется при `τ`, если
 * `significance[i] > τ²` — минимум расстояний делений на пути от корня до неё (0 — не делила).
 */
function douglasPeucker(xs: Float64Array, ys: Float64Array, tolerance2: number): Float64Array {
  const significance = new Float64Array(xs.length);
  const farthest = new FarthestPoint(xs, ys);
  let scanBudget = SCAN_BUDGET_PER_POINT * xs.length;
  const stack: number[] = [0, xs.length - 1, Infinity];

  while (stack.length > 0) {
    const parent = stack.pop()!;
    const end = stack.pop()!;
    const start = stack.pop()!;
    scanBudget -= end - start;
    if (scanBudget < 0) {
      farthest.buildHulls();
      scanBudget = Infinity;
    }
    const index = farthest.between(start, end);
    if (index >= 0 && farthest.distance2 > tolerance2) {
      const own = Math.min(farthest.distance2, parent);
      significance[index] = own;
      stack.push(start, index, own, index, end, own);
    }
  }
  return significance;
}

/**
 * Перебор диапазонов дешевле построения оболочек, пока деления сбалансированы (обычный трек — ~log n проходов по
 * точкам); оболочки строятся, когда суммарный перебор превысил столько проходов (ничьи на стоянке).
 */
const SCAN_BUDGET_PER_POINT = 24;

/** Замкнутая петля (начало = конец) при большом допуске сводится к двум одинаковым точкам — добавляем дальнюю. */
function ensureTwoDistinct(kept: number[], xs: Float64Array, ys: Float64Array): number[] {
  const first = kept[0]!;
  if (kept.some((index) => xs[index] !== xs[first] || ys[index] !== ys[first])) return kept;
  let farthest = first;
  let farthestDistance2 = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const d2 = (xs[i]! - xs[first]!) ** 2 + (ys[i]! - ys[first]!) ** 2;
    if (d2 > farthestDistance2) {
      farthestDistance2 = d2;
      farthest = i;
    }
  }
  if (farthest === first) return [];
  return [...kept, farthest].sort((a, b) => a - b);
}
