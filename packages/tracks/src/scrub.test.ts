import { describe, expect, it } from 'vitest';

import { haversineMeters } from './geo.ts';
import {
  cumulativeMeters,
  elevationAt,
  gainTo,
  gradeAt,
  nearestFraction,
  PROFILE_FLOOR,
  profileHeights,
  profilePoints,
  pointAtFraction,
  stepDistance,
  type Planar,
  type ProfilePoint,
} from './scrub.ts';

describe('cumulativeMeters', () => {
  it('накопленная длина линии [lon, lat] по haversine: от 0 до полной длины', () => {
    const line = [
      [27.5, 53.9],
      [27.51, 53.9],
      [27.51, 53.91],
    ] as const;
    const cumulative = cumulativeMeters(line);
    const first = haversineMeters({ lon: 27.5, lat: 53.9 }, { lon: 27.51, lat: 53.9 });
    const second = haversineMeters({ lon: 27.51, lat: 53.9 }, { lon: 27.51, lat: 53.91 });
    expect(cumulative).toHaveLength(3);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBeCloseTo(first, 6);
    expect(cumulative[2]).toBeCloseTo(first + second, 6);
    expect(cumulativeMeters([])).toEqual([]);
  });
});

describe('pointAtFraction', () => {
  const points: Planar[] = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];
  const cumulative = [0, 100, 200];

  it('доля 0 и 1 — концы, середина — по накопленной длине, интерполяция внутри сегмента', () => {
    expect(pointAtFraction(points, cumulative, 0)).toEqual([0, 0]);
    expect(pointAtFraction(points, cumulative, 1)).toEqual([100, 100]);
    expect(pointAtFraction(points, cumulative, 0.5)).toEqual([100, 0]);
    expect(pointAtFraction(points, cumulative, 0.25)).toEqual([50, 0]);
    expect(pointAtFraction(points, cumulative, 0.75)).toEqual([100, 50]);
  });

  it('за пределами 0…1 — концы; вырожденная линия (длина 0, одна точка) — первая точка', () => {
    expect(pointAtFraction(points, cumulative, -1)).toEqual([0, 0]);
    expect(pointAtFraction(points, cumulative, 2)).toEqual([100, 100]);
    expect(pointAtFraction([[5, 5]], [0], 0.5)).toEqual([5, 5]);
    expect(
      pointAtFraction(
        [
          [5, 5],
          [5, 5],
        ],
        [0, 0],
        0.5,
      ),
    ).toEqual([5, 5]);
  });
});

describe('nearestFraction', () => {
  it('прямая: проекция точки на линию — доля по длине; без подсказки — глобальный минимум', () => {
    const points: Planar[] = [
      [0, 0],
      [100, 0],
      [200, 0],
    ];
    expect(nearestFraction(points, [0, 100, 200], [50, 30], null, 1)).toBeCloseTo(0.25, 9);
    expect(nearestFraction(points, [0, 100, 200], [150, -5], null, 1)).toBeCloseTo(0.75, 9);
    // за концами — концы
    expect(nearestFraction(points, [0, 100, 200], [-50, 0], null, 1)).toBe(0);
    expect(nearestFraction(points, [0, 100, 200], [300, 10], null, 1)).toBe(1);
  });

  it('туда-обратно: участки совпадают — выбирается проход, ближний к подсказке', () => {
    // 0 → 100 → 0 по оси X
    const points: Planar[] = [
      [0, 0],
      [100, 0],
      [0, 0],
    ];
    const cumulative = [0, 100, 200];
    expect(nearestFraction(points, cumulative, [30, 0], 0.1, 1)).toBeCloseTo(0.15, 9);
    expect(nearestFraction(points, cumulative, [30, 0], 0.9, 1)).toBeCloseTo(0.85, 9);
  });

  it('петля (старт = финиш): у старта при подсказке у финиша — финиш, а не прыжок на старт', () => {
    // квадрат 0,0 → 100,0 → 100,100 → 0,100 → 0,0
    const points: Planar[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const cumulative = [0, 100, 200, 300, 400];
    // точка у старта, чуть внутри: ближе к первому участку (2 px), но в пределах допуска от последнего (3 px)
    const target: Planar = [3, 2];
    expect(nearestFraction(points, cumulative, target, null, 5)).toBeCloseTo(3 / 400, 9);
    expect(nearestFraction(points, cumulative, target, 0.97, 5)).toBeCloseTo((400 - 2) / 400, 9);
    // вне допуска подсказка не мешает: ближайший участок
    expect(nearestFraction(points, cumulative, [50, 40], 0.97, 5)).toBeCloseTo(50 / 400, 9);
  });

  it('движение вдоль прохода: соседний участок в пределах допуска не тянет назад к подсказке', () => {
    const points: Planar[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ];
    const cumulative = [0, 10, 20, 30];
    expect(nearestFraction(points, cumulative, [25, 0], 0.1, 50)).toBeCloseTo(25 / 30, 9);
  });

  it('вырожденная линия — 0', () => {
    expect(nearestFraction([[1, 1]], [0], [5, 5], null, 1)).toBe(0);
  });
});

describe('профиль: высота, уклон, набор', () => {
  // 0 → 1000 м подъём на 50 м (5 %), 1000 → 2000 м спуск на 30 м (−3 %)
  const profile: ProfilePoint[] = [
    [0, 200],
    [250, 212.5],
    [500, 225],
    [750, 237.5],
    [1000, 250],
    [1250, 242.5],
    [1500, 235],
    [1750, 227.5],
    [2000, 220],
  ];

  it('elevationAt: линейная интерполяция, за краями — края', () => {
    expect(elevationAt(profile, 0)).toBe(200);
    expect(elevationAt(profile, 125)).toBeCloseTo(206.25, 9);
    expect(elevationAt(profile, 1000)).toBe(250);
    expect(elevationAt(profile, -10)).toBe(200);
    expect(elevationAt(profile, 5000)).toBe(220);
    expect(elevationAt([], 10)).toBe(0);
    expect(elevationAt([[0, 7]], 10)).toBe(7);
  });

  it('gradeAt: окно ±100 м, целый %, спуск — минус, у краёв окно сдвигается внутрь', () => {
    expect(gradeAt(profile, 500)).toBe(5);
    expect(gradeAt(profile, 1500)).toBe(-3);
    // у старта окно 0…200 м — тот же подъём
    expect(gradeAt(profile, 0)).toBe(5);
    expect(gradeAt(profile, 2000)).toBe(-3);
    // на переломе (1000 м): окно 900…1100 — (247 − 245) / 200 → 1 %
    expect(gradeAt(profile, 1000)).toBe(1);
    // −0,15 % округляется до 0, а не до «−0»
    const flatDown: ProfilePoint[] = [
      [0, 0],
      [400, -0.6],
    ];
    expect(Object.is(gradeAt(flatDown, 200), 0)).toBe(true);
  });

  it('gradeAt: шаг профиля > 200 м — окно = шаг; ровный — 0; вырожденный — 0', () => {
    const coarse: ProfilePoint[] = [
      [0, 100],
      [1000, 100],
      [2000, 160],
    ];
    // окно 1000 м вокруг 1500: 1000…2000 → 6 %
    expect(gradeAt(coarse, 1500)).toBe(6);
    expect(gradeAt(coarse, 400)).toBe(0);
    expect(gradeAt([[0, 5]], 0)).toBe(0);
    expect(Object.is(gradeAt([], 0), 0)).toBe(true);
  });

  it('gradeAt: округление до целого (4,6 → 5, −2,5 → −2)', () => {
    const gentle: ProfilePoint[] = [
      [0, 0],
      [200, 9.2],
      [400, 4.2],
    ];
    expect(gradeAt(gentle, 100)).toBe(5);
    expect(gradeAt(gentle, 300)).toBe(-2);
  });

  it('gainTo: сырой набор (только подъёмы), масштаб к набору сервера на финише', () => {
    expect(gainTo(profile, 0, null)).toBe(0);
    expect(gainTo(profile, 500, null)).toBe(25);
    expect(gainTo(profile, 2000, null)).toBe(50);
    // сервер насчитал 60 м: распределяем вдоль маршрута, на финише — ровно 60
    expect(gainTo(profile, 500, 60)).toBe(30);
    expect(gainTo(profile, 2000, 60)).toBe(60);
    // спуск набор не уменьшает (монотонность)
    expect(gainTo(profile, 1500, 60)).toBe(60);
    // набора по профилю нет — сырой (0), без деления на ноль
    expect(
      gainTo(
        [
          [0, 10],
          [100, 5],
        ],
        100,
        40,
      ),
    ).toBe(0);
  });

  it('gainTo: монотонно не убывает по дистанции', () => {
    let previous = 0;
    for (let d = 0; d <= 2000; d += 37) {
      const gain = gainTo(profile, d, 61);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });
});

describe('stepDistance (шаг adjustable 1 км)', () => {
  it('вперёд — к следующему целому км, последний шаг — до конца', () => {
    expect(stepDistance(0, 3500, 1)).toBe(1000);
    expect(stepDistance(1400, 3500, 1)).toBe(2000);
    expect(stepDistance(3000, 3500, 1)).toBe(3500);
    expect(stepDistance(3500, 3500, 1)).toBe(3500);
  });

  it('назад — к предыдущему целому км, с нецелого — к целому ниже; граница 0', () => {
    expect(stepDistance(3500, 3500, -1)).toBe(3000);
    expect(stepDistance(1400, 3500, -1)).toBe(1000);
    expect(stepDistance(1000, 3500, -1)).toBe(0);
    expect(stepDistance(0, 3500, -1)).toBe(0);
  });

  it('погрешность доли (999,9999 / 1000,0001) не застревает на месте', () => {
    expect(stepDistance(1000.0000001, 3500, -1)).toBe(0);
    expect(stepDistance(999.9999999, 3500, 1)).toBe(2000);
  });
});

describe('profileHeights / profilePoints', () => {
  it('высоты — доля графика: мин. — пол, макс. — 1, ровный — середина', () => {
    expect(profileHeights([191, 267], 191, 267)).toEqual([PROFILE_FLOOR, 1]);
    expect(profileHeights([5, 5], 5, 5)).toEqual([0.5, 0.5]);
  });

  it('точки [x, y] в долях: X по дистанции, меньше двух точек — пусто', () => {
    expect(
      profilePoints(
        [
          [0, 191],
          [500, 267],
          [1000, 191],
        ],
        191,
        267,
      ),
    ).toEqual([
      [0, PROFILE_FLOOR],
      [0.5, 1],
      [1, PROFILE_FLOOR],
    ]);
    expect(profilePoints([[0, 1]], 1, 1)).toEqual([]);
  });
});
