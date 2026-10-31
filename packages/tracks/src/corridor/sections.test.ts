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

  it('«туда-обратно» 2 × 15 км по одной дороге: слитый участок с разворотом проходит свои ворота — участков нет', () => {
    const outback = path([
      [0, 0],
      [0, 15_000],
      [0, 0],
    ]);
    expect(routeSections(outback, 50)).toEqual([]);
  });

  it.each([15_070, 15_080, 15_100])(
    '«туда-обратно» по одной дороге до %i м: участок с разворотом проходит у своих ворот — участков нет',
    (turnM) => {
      const outback = path([
        [0, 0],
        [0, turnM],
        [0, 0],
      ]);
      expect(routeSections(outback, 50)).toEqual([]);
    },
  );

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

  it('«туда-обратно», где всё сливается в один участок — участков нет', () => {
    const spurs = path([
      [0, 0],
      [0, 5000],
      [0, 0],
      [0, 5000],
      [0, 0],
    ]);
    expect(routeSections(spurs, 50)).toEqual([]);
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
