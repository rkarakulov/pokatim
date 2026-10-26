import { describe, expect, it } from 'vitest';

import { haversineMeters, trackLengthMeters } from '../geo.ts';
import { corridorGateRadiusM, type CorridorGeometry } from '../track.ts';
import { CORRIDOR_POLICY } from './policy.ts';
import {
  chordOutsideM,
  CorridorError,
  gridCandidates,
  prepareCorridor,
  visitMarks,
} from './prepare.ts';

const CENTER = { lat: 53.9006, lon: 27.559 };
const M_LAT = 111_195;
const M_LON = M_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
const at = (x: number, y: number): [number, number] => [
  CENTER.lon + x / M_LON,
  CENTER.lat + y / M_LAT,
];
const geometry = (line: [number, number][], overrides: Partial<CorridorGeometry> = {}) => ({
  line,
  widthM: 50,
  isLoop: false,
  distanceM: trackLengthMeters(line.map(([lon, lat]) => ({ lon, lat }))),
  ...overrides,
});

describe('prepareCorridor', () => {
  const line = [at(0, 0), at(3000, 0), at(3000, 2000)];
  const corridor = prepareCorridor(geometry(line));

  it('уплотняет линию до отрезков ≤ 25 м, сохраняя вершины и длину', () => {
    let maxStep = 0;
    for (let i = 1; i < corridor.lon.length; i += 1) {
      maxStep = Math.max(
        maxStep,
        haversineMeters(
          { lon: corridor.lon[i - 1]!, lat: corridor.lat[i - 1]! },
          { lon: corridor.lon[i]!, lat: corridor.lat[i]! },
        ),
      );
    }
    expect(maxStep).toBeLessThanOrEqual(25.0001);
    expect(corridor.lon.length).toBeGreaterThanOrEqual(201);
    expect(corridor.lon.length).toBeLessThanOrEqual(203);
    const corner = Array.from(corridor.lon).findIndex(
      (value, i) => value === line[1]![0] && corridor.lat[i] === line[1]![1],
    );
    expect(corner).toBeGreaterThan(0);
    expect(corridor.lengthM).toBeCloseTo(5000, -1);
    expect(corridor.chainage[0]).toBe(0);
    expect(corridor.chainage[corridor.chainage.length - 1]).toBe(corridor.lengthM);
  });

  it('ворота — max(widthM, 30 м) вокруг концов линии; ячейки 250 м; distanceM — диагностика', () => {
    expect(prepareCorridor(geometry(line, { distanceM: 5200 })).declaredDistanceM).toBe(5200);
    expect(corridor.gateRadiusM).toBe(50);
    expect(corridor.startGate).toEqual([line[0]![0], line[0]![1]]);
    expect(corridor.finishGate).toEqual([line[2]![0], line[2]![1]]);
    expect(corridor.coverageCells).toBe(Math.ceil(corridor.lengthM / 250));

    const narrow = prepareCorridor(geometry(line, { widthM: 20 }));
    expect(narrow.gateRadiusM).toBe(30);
    const loopLine = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 0)];
    const loop = prepareCorridor(geometry(loopLine, { isLoop: true }));
    expect(loop.finishGate).toEqual(loop.startGate);
  });

  it('сетка находит отрезки в радиусе и только их', () => {
    const out = new Int32Array(corridor.lon.length);
    const stamp = new Int32Array(corridor.lon.length);
    const [lon, lat] = at(1500, 100);
    const count = gridCandidates(corridor, lon, lat, 150, out, stamp, 1);
    const found = Array.from(out.subarray(0, count));
    // точка над первой стороной: найдены отрезки, проходящие x = 1350…1650 м, и только первой стороны
    const covering = (j: number) => {
      const x0 = (corridor.lon[j]! - CENTER.lon) * M_LON;
      const x1 = (corridor.lon[j + 1]! - CENTER.lon) * M_LON;
      return corridor.lat[j] === CENTER.lat && Math.max(x0, x1) >= 1350 && Math.min(x0, x1) <= 1650;
    };
    const expected = Array.from({ length: corridor.lon.length - 1 }, (_, j) => j).filter(covering);
    expect(expected.length).toBeGreaterThanOrEqual(12);
    for (const j of expected) expect(found).toContain(j);
    expect(found.every((j) => corridor.lat[j] === CENTER.lat)).toBe(true);
    const [farLon, farLat] = at(1500, 2000);
    expect(gridCandidates(corridor, farLon, farLat, 150, out, stamp, 2)).toBe(0);
  });

  it('прореживание: частые вершины прямой схлопываются, разворот по той же дороге — нет', () => {
    const dense = Array.from({ length: 10_001 }, (_, i) => at(i, i % 2 === 0 ? 0 : 0.4));
    const straight = prepareCorridor(geometry(dense));
    expect(straight.lon.length).toBeLessThan(450);
    expect(straight.lengthM).toBeCloseTo(10_000, -1);

    // 0 → 5 км → назад до 3 км → 10 км: обратный ход 2 км сохраняется (длина 14 км)
    const xs = [
      ...Array.from({ length: 5001 }, (_, i) => i),
      ...Array.from({ length: 2000 }, (_, i) => 4999 - i),
      ...Array.from({ length: 7001 }, (_, i) => 3000 + i),
    ];
    const back = prepareCorridor(geometry(xs.map((x) => at(x, 0))));
    expect(back.lengthM).toBeCloseTo(14_000, -1);
  });

  it('метки посещения сетки не переполняются: > 65 536 расчётов хорды — тот же результат (ревью pass 5)', () => {
    const corridor = prepareCorridor(
      geometry(
        [
          [CENTER.lon, CENTER.lat],
          [at(500, 0)[0], at(500, 0)[1]],
        ],
        { widthM: 175 },
      ),
    );
    const segments = corridor.lon.length - 1;
    const out = new Int32Array(segments);
    const visits = visitMarks(segments);
    const lows = new Float64Array(segments);
    const highs = new Float64Array(segments);
    const [aLon, aLat] = at(499, 173);
    const [bLon, bLat] = at(339, 167);
    const chord = () =>
      chordOutsideM(corridor, aLon, aLat, bLon, bLat, out, visits, lows, highs, { count: 0 });
    expect(chord()).toBe(0);
    // граница Int32 меток: поколение сбрасывается, повторы не проходят
    visits.current = 0x7fffffff - 3;
    for (let i = 0; i < 70_000; i += 1) expect(chord()).toBe(0);
  });

  it('инварианты входа — исключение программиста', () => {
    expect(() => prepareCorridor(geometry(line, { widthM: 10 }))).toThrow(/widthM/);
    expect(() => prepareCorridor(geometry(line, { widthM: 250 }))).toThrow(/widthM/);
    expect(() => prepareCorridor(geometry([at(0, 0)]))).toThrow(/line size/);
    expect(() => prepareCorridor(geometry([at(0, 0), at(0, 0)], { distanceM: 1 }))).toThrow(
      /distinct/,
    );
    expect(() =>
      prepareCorridor(
        geometry([
          [27.559, 53.9],
          [27.5595, 53.9],
        ]),
      ),
    ).toThrow(/gates overlap/);
    expect(() => prepareCorridor(geometry([at(0, 0), [200, 0]], { distanceM: 1 }))).toThrow(
      /coordinate/,
    );
    const huge = Array.from({ length: 20_001 }, (_, i) => at(i, 0));
    expect(() => prepareCorridor(geometry(huge))).toThrow(/line size/);
  });

  it('нарушение инварианта — CorridorError (ворота, плотность линии)', () => {
    const overlap = () =>
      prepareCorridor(
        geometry([
          [27.559, 53.9],
          [27.5595, 53.9],
        ]),
      );
    expect(overlap).toThrow(CorridorError);
    // зигзаг в одной ячейке сетки: развороты не прореживаются, отрезков в ячейке > 32
    const zigzag = Array.from({ length: 40 }, (_, i) => at(i % 2 === 0 ? 0 : 100, i));
    expect(() => prepareCorridor(geometry(zigzag, { isLoop: true }))).toThrow(CorridorError);
    expect(() => prepareCorridor(geometry(zigzag, { isLoop: true }))).toThrow(/too dense/);
  });

  it('радиус ворот — corridorGateRadiusM', () => {
    for (const widthM of [20, 30, 50, 200]) {
      expect(CORRIDOR_POLICY.gateRadius(widthM)).toBe(corridorGateRadiusM(widthM));
    }
    expect(corridorGateRadiusM(20)).toBe(30);
    expect(corridorGateRadiusM(50)).toBe(50);
    expect(prepareCorridor(geometry(line)).gateRadiusM).toBe(50);
  });
});
