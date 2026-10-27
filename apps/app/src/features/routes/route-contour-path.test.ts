/// <reference types="jest" />
import { localProjection } from '@pokatim/tracks';

import { contourPath, CONTOUR_VIEW } from './route-contour-path';

const VIEW = { width: 200, height: 100, padding: 10 };

/** Координаты из пути `M x,y L x,y …`. */
const points = (d: string) =>
  d
    .slice(1)
    .split('L')
    .map((pair) => pair.split(',').map(Number) as [number, number]);

describe('contourPath — контур маршрута в viewBox', () => {
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

  it('viewBox героя — константа раскладки', () => {
    expect(CONTOUR_VIEW.width).toBeGreaterThan(CONTOUR_VIEW.height);
  });
});
