import { describe, expect, it } from 'vitest';

import { FarthestPoint } from './farthest-point.ts';

/** Полный перебор: дальняя точка строго между `start` и `end`, при равенстве — меньший индекс. */
function scan(xs: Float64Array, ys: Float64Array, start: number, end: number) {
  let distance2 = -1;
  let index = -1;
  for (let i = start + 1; i < end; i += 1) {
    const dx = xs[end]! - xs[start]!;
    const dy = ys[end]! - ys[start]!;
    const px = xs[i]! - xs[start]!;
    const py = ys[i]! - ys[start]!;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / length2));
    const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
    if (d2 > distance2) [distance2, index] = [d2, i];
  }
  return { index, distance2 };
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

function expectSameAsScan(points: [number, number][], ranges: number, seed: number) {
  const xs = Float64Array.from(points, ([x]) => x);
  const ys = Float64Array.from(points, ([, y]) => y);
  const farthest = new FarthestPoint(xs, ys);
  farthest.buildHulls();
  const next = random(seed);
  for (let k = 0; k < ranges; k += 1) {
    const start = Math.floor(next() * points.length);
    const end = Math.min(points.length - 1, start + 1 + Math.floor(next() * points.length));
    const expected = scan(xs, ys, start, end);
    expect(farthest.between(start, end), `[${start}, ${end}]`).toBe(expected.index);
    expect(farthest.distance2).toBe(expected.distance2);
  }
}

describe('FarthestPoint по оболочкам = полному перебору', () => {
  it('ряды точек на одной прямой в перемешанном порядке — ничья по меньшему индексу, не по краю ряда', () => {
    const next = random(7);
    const row = Array.from({ length: 400 }, (_, i): [number, number] => [
      i % 40,
      10 * Math.floor(i / 40),
    ]);
    for (let i = row.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [row[i], row[j]] = [row[j]!, row[i]!];
    }
    const xs = [[-5, 0], ...row, [45, 0]] as [number, number][];
    expectSameAsScan(xs, 2000, 1);
    // хорда вдоль y = 0: весь верхний ряд на одном расстоянии — первая по индексу точка ряда
    const farthest = new FarthestPoint(
      Float64Array.from(xs, ([x]) => x),
      Float64Array.from(xs, ([, y]) => y),
    );
    farthest.buildHulls();
    const top = xs.findIndex(([, y]) => y === 90);
    expect(farthest.between(0, xs.length - 1)).toBe(top);
  });

  it('стоянка: повторы нескольких координат вперемешку', () => {
    const next = random(3);
    const spots: [number, number][] = [
      [0, 0],
      [3, 1],
      [-2, 4],
      [1, -3],
    ];
    expectSameAsScan(
      Array.from({ length: 5000 }, () => spots[Math.floor(next() * spots.length)]!),
      2000,
      2,
    );
  });

  it('случайный трек с шумом, кольцо, длины не кратные размеру листа', () => {
    for (const count of [1, 2, 17, 33, 1000, 4099]) {
      const next = random(count);
      expectSameAsScan(
        Array.from({ length: count }, (_, i): [number, number] => [
          Math.cos(i / 50) * 300 + next() * 3,
          Math.sin(i / 50) * 300 + next() * 3,
        ]),
        500,
        count,
      );
    }
  });
});
