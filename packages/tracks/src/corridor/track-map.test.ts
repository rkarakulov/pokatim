import { describe, expect, it } from 'vitest';

import { simplifyTrack } from '../simplify.ts';
import type { ParsedPoint } from '../track.ts';
import { at, T0, type Xy } from './__testing__/synthetic.ts';
import { TRACK_MAP_MAX_RUNS, trackMapOf } from './track-map.ts';
import type { CorridorSegment } from './types.ts';

/** Точка в метрах от центра; `t` — секунды от T0, `null` — без времени. */
const point = ([x, y]: Xy, t: number | null): ParsedPoint => {
  const [lon, lat] = at([x, y]);
  return t === null ? { lon, lat } : { lon, lat, time: new Date(T0 + t * 1000) };
};
const segmentOf = (fromS: number, toS: number): CorridorSegment => ({
  startedAt: new Date(T0 + fromS * 1000),
  finishedAt: new Date(T0 + toS * 1000),
  elapsedMs: (toS - fromS) * 1000,
  elapsedSec: toS - fromS,
  distanceM: 0,
  offCorridorM: 0,
  offCorridorShare: 0,
  maxExcursionM: 0,
  coverage: 1,
  noisePoints: 0,
});
const ms = (s: number) => T0 + s * 1000;
const lineOf = (points: ParsedPoint[]) =>
  simplifyTrack(points, 5, 1000).map((p): [number, number] => [p.lon, p.lat]);

/** Прямая на восток 100 м, точка раз в 10 с (1 м/с): упрощённая линия — две вершины. */
const straight = Array.from({ length: 11 }, (_, k) => point([k * 10, 0], k * 10));

describe('trackMapOf (RC-2: время → путь по исходнику → позиция на линии)', () => {
  it('прямая: позиции — доля пути по линии; сегмент и интервалы', () => {
    const line = lineOf(straight);
    expect(line).toHaveLength(2);
    expect(trackMapOf(straight, line, segmentOf(0, 100), [[ms(20), ms(50)]])).toEqual({
      linePoints: 2,
      segment: [0, 1],
      offRuns: [[0.2, 0.5]],
    });
  });

  it('стоянка внутри отрезка линии не сдвигает позицию (путь, а не время вершин)', () => {
    // 0…50 м за 5 с, стоянка 120 с (одинаковые координаты), 50…100 м за 5 с
    const points = [
      ...Array.from({ length: 6 }, (_, k) => point([k * 10, 0], k)),
      point([50, 0], 125),
      ...Array.from({ length: 5 }, (_, k) => point([60 + k * 10, 0], 126 + k)),
    ];
    const line = lineOf(points);
    expect(line).toHaveLength(2);
    const map = trackMapOf(points, line, segmentOf(0, 130), [[ms(100), ms(127)]])!;
    // по времени вершин (0 с … 130 с) было бы 0.769; по пути — 0.5
    expect(map.offRuns).toEqual([[0.5, 0.7]]);
  });

  it('вершина без времени: путь между соседними точками со временем', () => {
    const points = [
      point([0, 0], 0),
      point([50, 0], 50),
      point([100, 0], null),
      point([100, 50], 150),
      point([100, 100], 200),
    ];
    const line = lineOf(points);
    expect(line).toHaveLength(3);
    const map = trackMapOf(points, line, segmentOf(0, 200), [[ms(125), ms(175)]])!;
    // 125 с — между 50 м (50 с) и 150 м (150 с): путь 125 м → вторая половина второго отрезка
    expect(map.offRuns[0]![0]).toBeCloseTo(1.25, 3);
    expect(map.offRuns[0]![1]).toBeCloseTo(1.75, 3);
    expect(map.segment).toEqual([0, 2]);
  });

  it('равные времена: начало — первая точка с этим временем, конец — последняя', () => {
    const points = [point([0, 0], 0), point([10, 0], 10), point([20, 0], 10), point([30, 0], 20)];
    const map = trackMapOf(points, lineOf(points), segmentOf(0, 20), [[ms(10), ms(10)]])!;
    expect(map.offRuns).toEqual([[0.333, 0.667]]);
  });

  it('интервал на границе вершины — целая позиция', () => {
    const points = [point([0, 0], 0), point([100, 0], 100), point([100, 100], 200)];
    const map = trackMapOf(points, lineOf(points), segmentOf(0, 200), [[ms(100), ms(150)]])!;
    expect(map.offRuns).toEqual([[1, 1.5]]);
  });

  it('обрезка границами сегмента; пустые после обрезки — отбрасываются; округление до 0,001', () => {
    const map = trackMapOf(straight, lineOf(straight), segmentOf(10, 90), [
      [ms(0), ms(5)],
      [ms(5), ms(30)],
      [ms(33.33333), ms(40)],
      [ms(80), ms(100)],
    ])!;
    expect(map.segment).toEqual([0.1, 0.9]);
    expect(map.offRuns).toEqual([
      [0.1, 0.3],
      [0.333, 0.4],
      [0.8, 0.9],
    ]);
  });

  it('соседние и перекрытые сливаются всегда', () => {
    const map = trackMapOf(straight, lineOf(straight), segmentOf(0, 100), [
      [ms(10), ms(20)],
      [ms(20), ms(30)],
      [ms(25), ms(40)],
      [ms(60), ms(70)],
    ])!;
    expect(map.offRuns).toEqual([
      [0.1, 0.4],
      [0.6, 0.7],
    ]);
  });

  it(`больше ${TRACK_MAP_MAX_RUNS} интервалов — сливаются пары с наименьшим зазором`, () => {
    // 1 000 м, точка раз в секунду; 150 выходов по 2 с, зазор 4 с, у каждого десятого — 1 с
    const points = Array.from({ length: 1001 }, (_, k) => point([k, 0], k));
    const line = lineOf(points);
    const runs: [number, number][] = [];
    let t = 10;
    for (let i = 0; i < 150; i += 1) {
      runs.push([ms(t), ms(t + 2)]);
      t += 2 + (i % 10 === 9 ? 1 : 4);
    }
    const map = trackMapOf(points, line, segmentOf(0, 1000), runs)!;
    expect(map.offRuns).toHaveLength(TRACK_MAP_MAX_RUNS);
    // сначала слиты 14 пар с зазором 1 с, затем 36 первых пар с зазором 4 с (при равенстве — левее)
    const total = map.offRuns.reduce((sum, [from, to]) => sum + to - from, 0);
    expect(total).toBeCloseTo((150 * 2 + 14 * 1 + 36 * 4) / 1000, 6);
    for (let i = 1; i < map.offRuns.length; i += 1) {
      expect(map.offRuns[i]![0]).toBeGreaterThan(map.offRuns[i - 1]![1]);
    }
  });

  it('нет сегмента или линия < 2 точек — null; результат без координат и времени', () => {
    expect(trackMapOf(straight, lineOf(straight), null, [])).toBeNull();
    expect(trackMapOf(straight, [], segmentOf(0, 100), [])).toBeNull();
    expect(trackMapOf(straight, null, segmentOf(0, 100), [])).toBeNull();
    // линия другого файла: вершины нет в исходнике
    const foreign = lineOf(straight.map((p) => ({ ...p, lat: p.lat + 0.001 })));
    expect(trackMapOf(straight, foreign, segmentOf(0, 100), [])).toBeNull();
    const map = trackMapOf(straight, lineOf(straight), segmentOf(0, 100), []);
    expect(map).toEqual({ linePoints: 2, segment: [0, 1], offRuns: [] });
    expect(structuredClone(map)).toEqual(map);
  });
});
