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

  const limit = Math.max(maxPoints, 3);
  let tolerance = Math.max(toleranceM, 0.01);
  for (;;) {
    const kept = douglasPeucker(xs, ys, tolerance);
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

/** Индексы сохранённых точек по возрастанию. */
function douglasPeucker(xs: Float64Array, ys: Float64Array, tolerance: number): number[] {
  const last = xs.length - 1;
  const keep = new Uint8Array(xs.length);
  keep[0] = 1;
  keep[last] = 1;
  const stack: number[] = [0, last];
  const tolerance2 = tolerance * tolerance;

  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    let maxDistance2 = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d2 = segmentDistance2(xs, ys, i, start, end);
      if (d2 > maxDistance2) {
        maxDistance2 = d2;
        maxIndex = i;
      }
    }
    if (maxIndex >= 0 && maxDistance2 > tolerance2) {
      keep[maxIndex] = 1;
      stack.push(start, maxIndex, maxIndex, end);
    }
  }

  const result: number[] = [];
  for (let i = 0; i <= last; i += 1) if (keep[i] === 1) result.push(i);
  return result;
}

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

function segmentDistance2(
  xs: Float64Array,
  ys: Float64Array,
  i: number,
  a: number,
  b: number,
): number {
  const ax = xs[a]!;
  const ay = ys[a]!;
  const dx = xs[b]! - ax;
  const dy = ys[b]! - ay;
  const px = xs[i]! - ax;
  const py = ys[i]! - ay;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return px * px + py * py;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / length2));
  return (px - t * dx) ** 2 + (py - t * dy) ** 2;
}
