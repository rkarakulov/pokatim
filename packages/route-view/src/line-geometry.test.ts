import { localProjection } from '@pokatim/tracks';
import { describe, expect, it } from 'vitest';

import { contourPath, pointAt, sliceLine } from './line-geometry.ts';

describe('sliceLine — участок линии по дробным позициям', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('дробные границы — интерполяция внутри отрезков, вершины между ними целиком', () => {
    expect(sliceLine(line, 0.5, 2.25)).toEqual([
      [5, 0],
      [10, 0],
      [10, 10],
      [7.5, 10],
    ]);
  });

  it('границы зажаты в [0, n − 1]', () => {
    expect(sliceLine(line, -3, 99)).toEqual(line);
  });

  it('пустой участок и пустая линия — null', () => {
    expect(sliceLine(line, 2, 2)).toBeNull();
    expect(sliceLine(line, 2, 1)).toBeNull();
    expect(sliceLine([], 0, 1)).toBeNull();
  });

  it('pointAt: целая позиция — вершина, последняя — последняя точка', () => {
    expect(pointAt(line, 1)).toEqual([10, 0]);
    expect(pointAt(line, 3)).toEqual([0, 10]);
  });
});

describe('contourPath — контур линии в viewBox', () => {
  const VIEW = { width: 200, height: 100, padding: 10 };

  /** Координаты из пути `M x,y L x,y …`. */
  const points = (d: string) =>
    d
      .slice(1)
      .split('L')
      .map((pair) => pair.split(',').map(Number) as [number, number]);

  it('вписывает рамку с полями и сохраняет пропорции (метры по долготе — с косинусом широты)', () => {
    const lat = 53.9;
    const { kx, ky } = localProjection(lat);
    // квадрат 1000 × 1000 м вокруг Минска
    const dLon = 1000 / kx;
    const dLat = 1000 / ky;
    const line: [number, number][] = [
      [27.5, lat],
      [27.5 + dLon, lat],
      [27.5 + dLon, lat + dLat],
      [27.5, lat + dLat],
    ];
    const contour = contourPath(line, [27.5, lat, 27.5 + dLon, lat + dLat], VIEW);
    expect(contour).not.toBeNull();
    const xy = points(contour!.d);
    const xs = xy.map(([x]) => x);
    const ys = xy.map(([, y]) => y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // квадрат остаётся квадратом, высота — по доступной (100 − 2 × 10), по ширине — по центру
    expect(height).toBeCloseTo(80, 0);
    expect(width).toBeCloseTo(80, 0);
    expect(Math.min(...ys)).toBeCloseTo(10, 0);
    expect(Math.min(...xs)).toBeCloseTo(60, 0);
  });

  it('север — вверху: старт южнее — ниже на картинке; старт — первая точка линии', () => {
    const contour = contourPath(
      [
        [27.5, 53.9],
        [27.5, 54.0],
      ],
      [27.5, 53.9, 27.5, 54.0],
      VIEW,
    );
    expect(contour).not.toBeNull();
    const [first, last] = points(contour!.d);
    expect(first![1]).toBeGreaterThan(last![1]);
    expect(contour!.start).toEqual(first);
  });

  it('путь начинается с M и соединяет точки L', () => {
    const contour = contourPath(
      [
        [27.5, 53.9],
        [27.6, 53.95],
        [27.7, 53.9],
      ],
      [27.5, 53.9, 27.7, 53.95],
      VIEW,
    );
    expect(contour!.d).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){2}$/);
  });

  it('вырожденная рамка (одна точка) — null', () => {
    expect(
      contourPath(
        [
          [27.5, 53.9],
          [27.5, 53.9],
        ],
        [27.5, 53.9, 27.5, 53.9],
        VIEW,
      ),
    ).toBeNull();
  });

  it('точки пути совпадают с путём', () => {
    const contour = contourPath(
      [
        [27.5, 53.9],
        [27.6, 53.95],
      ],
      [27.5, 53.9, 27.6, 53.95],
      { width: 200, height: 100, padding: 10 },
    );
    expect(`M${contour!.points.map(([x, y]) => `${x},${y}`).join('L')}`).toBe(contour!.d);
  });
});
