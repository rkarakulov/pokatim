import { describe, expect, it } from 'vitest';

import { haversineMeters } from '../geo.ts';
import { at, pointAt, type Xy } from './__testing__/synthetic.ts';
import { ROUTE_SECTION_POLICY, routeSections, sectionLine } from './sections.ts';

/** Линия на север длиной `lengthM` (вершины раз в 100 м + конец): по меридиану haversine = синтетике. */
function northLine(lengthM: number): [number, number][] {
  const points: Xy[] = [];
  for (let y = 0; y < lengthM; y += 100) points.push([0, y]);
  points.push([0, lengthM]);
  return points.map(at);
}

/** Ломаная по углам с вершинами раз в 100 м. */
function path(corners: readonly Xy[]): [number, number][] {
  const points: Xy[] = [corners[0]!];
  for (let i = 1; i < corners.length; i += 1) {
    const [ax, ay] = corners[i - 1]!;
    const [bx, by] = corners[i]!;
    const length = Math.hypot(bx - ax, by - ay);
    for (let d = 100; d < length; d += 100) {
      points.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length]);
    }
    points.push(corners[i]!);
  }
  return points.map(at);
}

const lonLat = ([lon, lat]: readonly [number, number]) => ({ lon, lat });

/** Расстояние между концами участка по линии (точки chainage — через `sectionLine`). */
function endsGap(line: [number, number][], fromM: number, toM: number): number {
  const sub = sectionLine(line, fromM, toM);
  return haversineMeters(lonLat(sub[0]!), lonLat(sub[sub.length - 1]!));
}

/** От каждых ворот участка по линии: после выхода из радиуса 150 м линия к ним не возвращается. */
function expectUngatedNone(line: [number, number][], sections: { fromM: number; toM: number }[]) {
  for (const { fromM, toM } of sections) {
    const sub = sectionLine(line, fromM, toM).map(lonLat);
    for (const walk of [sub, [...sub].reverse()]) {
      const far = walk.map((point) => haversineMeters(point, walk[0]!) > 150);
      expect(far.slice(far.indexOf(true))).not.toContain(false);
    }
  }
}

const ranges = (line: [number, number][], widthM = 50) =>
  routeSections(line, widthM).map(({ fromM, toM }) => [fromM, toM]);

describe('routeSections: разбиение через каждые 10 км', () => {
  it('маршрут короче 15 км — участков нет', () => {
    expect(routeSections(northLine(14_999), 50)).toEqual([]);
  });

  it('15 000 м — два участка: 10 км и хвост 5 км', () => {
    expect(ranges(northLine(15_000))).toEqual([
      [0, 10_000],
      [10_000, 15_000],
    ]);
  });

  it('24 999 м — хвост 4 999 м сливается с последним участком', () => {
    expect(ranges(northLine(24_999))).toEqual([
      [0, 10_000],
      [10_000, 24_999],
    ]);
  });

  it('25 000 м — хвост ровно 5 000 м — свой участок', () => {
    expect(ranges(northLine(25_000))).toEqual([
      [0, 10_000],
      [10_000, 20_000],
      [20_000, 25_000],
    ]);
  });

  it('304 999 м — 30 участков, последний 290 000–304 999', () => {
    const sections = routeSections(northLine(304_999), 50);
    expect(sections).toHaveLength(ROUTE_SECTION_POLICY.maxSections);
    expect(sections.at(-1)).toEqual({ fromM: 290_000, toM: 304_999 });
  });

  it('305 000 м — 31 участок больше предела — участков нет', () => {
    expect(routeSections(northLine(305_000), 50)).toEqual([]);
  });

  it('петля 40 км (конец = начало) — 4 участка, последний не сливается', () => {
    const loop = path([
      [0, 0],
      [10_000, 0],
      [10_000, 10_000],
      [0, 10_000],
      [0, 0],
    ]);
    const sections = routeSections(loop, 50);
    expect(sections).toHaveLength(4);
    for (const { fromM, toM } of sections) expect(endsGap(loop, fromM, toM)).toBeGreaterThan(150);
  });

  it.each([
    [
      17_000,
      [
        [0, 10_000],
        [10_000, 17_000],
        [17_000, 27_000],
        [27_000, 34_000],
      ],
    ],
    [
      15_000,
      [
        [0, 10_000],
        [10_000, 15_000],
        [15_000, 25_000],
        [25_000, 30_000],
      ],
    ],
    [
      12_000,
      [
        [0, 12_000],
        [12_000, 24_000],
      ],
    ],
  ])(
    '«туда-обратно» по одной дороге до %i м: граница в точке разворота, шаг 10 км — в каждом плече',
    (turnM, expected) => {
      const outback = path([
        [0, 0],
        [0, turnM],
        [0, 0],
      ]);
      const sections = routeSections(outback, 50);
      expect(sections.map(({ fromM, toM }) => [fromM, toM])).toEqual(expected);
      expectUngatedNone(outback, sections);
    },
  );

  it.each([15_070, 15_080, 15_100])(
    '«туда-обратно» по одной дороге до %i м: разворот рядом с шагом 10 км — граница в развороте',
    (turnM) => {
      const outback = path([
        [0, 0],
        [0, turnM],
        [0, 0],
      ]);
      const sections = routeSections(outback, 50);
      expect(sections.map(({ fromM, toM }) => [fromM, toM])).toEqual([
        [0, 10_000],
        [10_000, turnM],
        [turnM, turnM + 10_000],
        [turnM + 10_000, 2 * turnM],
      ]);
      expectUngatedNone(outback, sections);
    },
  );

  it('«туда-обратно» 2 × 20 км: разворот ровно на границе участка — 4 участка, ни один не проходит у своих ворот', () => {
    const outback = path([
      [0, 0],
      [0, 20_000],
      [0, 0],
    ]);
    const sections = routeSections(outback, 50);
    expect(sections.map(({ fromM, toM }) => [fromM, toM])).toEqual([
      [0, 10_000],
      [10_000, 20_000],
      [20_000, 30_000],
      [30_000, 40_000],
    ]);
    expectUngatedNone(outback, sections);
  });

  it.each([
    [100, 50, 0],
    [200, 50, 2],
    [200, 100, 0],
  ])(
    'линия участка возвращается к его началу на %i м (концы далеко), ширина %i → %i участков',
    (offsetM, widthM, count) => {
      const hairpin = path([
        [0, 0],
        [0, 4000],
        [offsetM, 4000],
        [offsetM, -4000],
        [offsetM + 8000, -4000],
      ]);
      const sections = routeSections(hairpin, widthM);
      expect(sections).toHaveLength(count);
      const threshold = 2 * Math.max(widthM, 30) + ROUTE_SECTION_POLICY.gateMarginM;
      for (const { fromM, toM } of sections) {
        expect(endsGap(hairpin, fromM, toM)).toBeGreaterThan(threshold);
      }
    },
  );

  it('дважды «туда-обратно» по 5 км — 4 участка по 5 км, граница в каждом развороте', () => {
    const spurs = path([
      [0, 0],
      [0, 5000],
      [0, 0],
      [0, 5000],
      [0, 0],
    ]);
    const sections = routeSections(spurs, 50);
    expect(sections.map(({ fromM, toM }) => [fromM, toM])).toEqual([
      [0, 5000],
      [5000, 10_000],
      [10_000, 15_000],
      [15_000, 20_000],
    ]);
    expectUngatedNone(spurs, sections);
  });

  it('разворот ближе 5 км к старту — не граница: прежнее слияние, участков нет', () => {
    // 4 км на север, обратно через старт и на юг 20 км: возврат к воротам старта, разворот на 4 км
    const hook = path([
      [0, 0],
      [0, 4000],
      [0, 0],
      [0, -20_000],
    ]);
    expect(routeSections(hook, 50)).toEqual([]);
  });

  it('детерминизм: два вызова и копия линии дают одно и то же', () => {
    const line = northLine(123_456);
    const copy = line.map(([lon, lat]): [number, number] => [lon, lat]);
    expect(routeSections(line, 50)).toEqual(routeSections(line, 50));
    expect(routeSections(copy, 50)).toEqual(routeSections(line, 50));
  });

  it('границы целые, без зазоров; последний toM = round(L)', () => {
    const line = northLine(57_321.4);
    const sections = routeSections(line, 50);
    expect(sections[0]!.fromM).toBe(0);
    for (let i = 0; i < sections.length; i += 1) {
      expect(Number.isInteger(sections[i]!.fromM)).toBe(true);
      expect(Number.isInteger(sections[i]!.toM)).toBe(true);
      if (i > 0) expect(sections[i]!.fromM).toBe(sections[i - 1]!.toM);
    }
    expect(sections.at(-1)!.toM).toBe(57_321);
  });
});

describe('sectionLine: подлиния участка', () => {
  const corners: Xy[] = [
    [0, 0],
    [0, 30_000],
  ];
  const line = northLine(30_000);

  it('концы интерполированы: до точки chainage < 1 м', () => {
    const sub = sectionLine(line, 12_345, 17_890);
    expect(haversineMeters(lonLat(sub[0]!), lonLat(at(pointAt(corners, 12_345))))).toBeLessThan(1);
    expect(
      haversineMeters(lonLat(sub[sub.length - 1]!), lonLat(at(pointAt(corners, 17_890)))),
    ).toBeLessThan(1);
  });

  it('граница внутри одного отрезка — ≥ 2 точки', () => {
    const twoPoints = [at([0, 0]), at([0, 20_000])];
    const sub = sectionLine(twoPoints, 5000, 6000);
    expect(sub.length).toBeGreaterThanOrEqual(2);
    expect(haversineMeters(lonLat(sub[0]!), lonLat(sub[sub.length - 1]!))).toBeCloseTo(1000, 0);
  });

  it('подлинии соседних участков стыкуются', () => {
    const first = sectionLine(line, 0, 10_000);
    const second = sectionLine(line, 10_000, 20_000);
    expect(first.at(-1)).toEqual(second[0]);
    expect(first[0]).toEqual(line[0]);
  });
});
