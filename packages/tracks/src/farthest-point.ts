// Дальняя точка диапазона для Дугласа — Пекера (`simplify.ts`); из пакета не экспортируется.
const BUCKET = 16;
/**
 * Почти коллинеарные точки остаются в оболочке: лишняя вершина безвредна, потерянная ничья — нет. Запас покрывает
 * округление при шаге координат ≫ 1e-9 размера узла (GPS — ≥ 1 см при проекции ~1e6 м).
 */
const COLLINEAR = 1e-9;

/**
 * Дальняя от отрезка `start`–`end` точка диапазона между ними — та же, что у полного перебора (при равенстве —
 * меньший индекс). Расстояние до отрезка выпукло, его максимум на множестве — в вершине выпуклой оболочки, поэтому
 * диапазон разбивается на узлы дерева отрезков с готовыми оболочками (повторы координат — одной вершиной с меньшим
 * индексом). На стоянке оболочка узла — несколько точек: запрос O(log n) вместо O(n), деление «по одной точке» на
 * ничьих больше не квадратично.
 */
export class FarthestPoint {
  /** Квадрат расстояния последней найденной точки. */
  distance2 = -1;
  private index = -1;
  private size = 0;
  private from = new Int32Array(0);
  private to = new Int32Array(0);
  private readonly hulls: number[] = [];
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;

  constructor(xs: Float64Array, ys: Float64Array) {
    this.xs = xs;
    this.ys = ys;
  }

  /** Строит оболочки узлов; до вызова `between` — полный перебор диапазона. */
  buildHulls(): void {
    const { xs, ys } = this;
    const buckets = Math.ceil(xs.length / BUCKET);
    let size = 1;
    while (size < buckets) size *= 2;
    this.size = size;
    this.from = new Int32Array(2 * size);
    this.to = new Int32Array(2 * size);
    const byPosition = (a: number, b: number) => xs[a]! - xs[b]! || ys[a]! - ys[b]! || a - b;
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const members: number[] = [];
      for (let i = bucket * BUCKET; i < Math.min((bucket + 1) * BUCKET, xs.length); i += 1) {
        members.push(i);
      }
      this.store(size + bucket, this.hull(members.sort(byPosition)));
    }
    for (let node = size - 1; node >= 1; node -= 1) {
      this.store(node, this.hull(this.merged(2 * node, 2 * node + 1)));
    }
  }

  /** Индекс дальней точки строго между `start` и `end` (`-1` — нет таких), расстояние — в `distance2`. */
  between(start: number, end: number): number {
    this.distance2 = -1;
    this.index = -1;
    const lo = start + 1;
    const firstBucket = Math.ceil(lo / BUCKET);
    const endBucket = Math.floor(end / BUCKET);
    if (this.size === 0 || firstBucket >= endBucket) {
      for (let i = lo; i < end; i += 1) this.consider(i, start, end);
      return this.index;
    }
    for (let i = lo; i < firstBucket * BUCKET; i += 1) this.consider(i, start, end);
    for (let i = endBucket * BUCKET; i < end; i += 1) this.consider(i, start, end);
    let left = firstBucket + this.size;
    let right = endBucket + this.size;
    while (left < right) {
      if ((left & 1) === 1) this.considerHull(left++, start, end);
      if ((right & 1) === 1) this.considerHull(--right, start, end);
      left >>= 1;
      right >>= 1;
    }
    return this.index;
  }

  private considerHull(node: number, start: number, end: number): void {
    for (let k = this.from[node]!; k < this.to[node]!; k += 1)
      this.consider(this.hulls[k]!, start, end);
  }

  private consider(i: number, start: number, end: number): void {
    const d2 = segmentDistance2(this.xs, this.ys, i, start, end);
    if (d2 > this.distance2 || (d2 === this.distance2 && i < this.index)) {
      this.distance2 = d2;
      this.index = i;
    }
  }

  private store(node: number, hull: number[]): void {
    this.from[node] = this.hulls.length;
    for (const index of hull) this.hulls.push(index);
    this.to[node] = this.hulls.length;
  }

  /** Вершины двух узлов по (x, y), повтор координат — меньшим индексом. */
  private merged(a: number, b: number): number[] {
    const { xs, ys, hulls } = this;
    const result: number[] = [];
    let i = this.from[a]!;
    let j = this.from[b]!;
    while (i < this.to[a]! || j < this.to[b]!) {
      let next: number;
      if (j >= this.to[b]!) next = hulls[i++]!;
      else if (i >= this.to[a]!) next = hulls[j++]!;
      else {
        const p = hulls[i]!;
        const q = hulls[j]!;
        const order = xs[p]! - xs[q]! || ys[p]! - ys[q]! || p - q;
        next = order < 0 ? hulls[i++]! : hulls[j++]!;
      }
      const prev = result[result.length - 1];
      if (prev === undefined || xs[prev] !== xs[next] || ys[prev] !== ys[next]) result.push(next);
    }
    return result;
  }

  /** Выпуклая оболочка (Эндрю) точек, упорядоченных по (x, y) с повторами подряд; вершины — в том же порядке. */
  private hull(sorted: readonly number[]): number[] {
    const { xs, ys } = this;
    const points = sorted.filter(
      (index, k) => k === 0 || xs[index] !== xs[sorted[k - 1]!] || ys[index] !== ys[sorted[k - 1]!],
    );
    if (points.length <= 2) return points;
    const vertex = new Uint8Array(points.length);
    for (const side of [1, -1]) {
      const chain: number[] = [];
      for (let k = 0; k < points.length; k += 1) {
        while (chain.length >= 2) {
          const o = points[chain[chain.length - 2]!]!;
          const a = points[chain[chain.length - 1]!]!;
          const b = points[k]!;
          const ax = xs[a]! - xs[o]!;
          const ay = ys[a]! - ys[o]!;
          const bx = xs[b]! - xs[o]!;
          const by = ys[b]! - ys[o]!;
          const slack = COLLINEAR * (Math.abs(ax) + Math.abs(ay)) * (Math.abs(bx) + Math.abs(by));
          if (side * (ax * by - ay * bx) >= -slack) break;
          chain.pop();
        }
        chain.push(k);
      }
      for (const k of chain) vertex[k] = 1;
    }
    return points.filter((_, k) => vertex[k] === 1);
  }
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
