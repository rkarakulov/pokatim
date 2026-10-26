import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { haversineMeters } from './geo.ts';
import { analyzeSeries } from './parse.ts';
import { buildSeries, SERIES_MAX_BINS, SERIES_MIN_BIN_M } from './series.ts';
import type { ParsedPoint } from './track.ts';

const T0 = Date.parse('2026-10-25T06:00:00Z');
/** ~11,1 м на 0,0001° широты: точка в секунду — 40 км/ч. */
const STEP_LAT = 0.0001;

/** Прямой трек на север, точка в секунду; `sensors(i)` — пульс и мощность точки. */
function line(
  count: number,
  sensors: (i: number) => Partial<Pick<ParsedPoint, 'hr' | 'power'>> = () => ({}),
): ParsedPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 53.9 + i * STEP_LAT,
    lon: 27.55,
    time: new Date(T0 + i * 1000),
    ...sensors(i),
  }));
}

const whole = (points: readonly ParsedPoint[]) => ({
  startedAt: points[0]!.time!,
  finishedAt: points.at(-1)!.time!,
});

describe('buildSeries', () => {
  it('ячейки равной дистанции: не уже SERIES_MIN_BIN_M, конец ячейки — накопленная дистанция, длины рядов равны', () => {
    const points = line(11, () => ({ hr: 150, power: 220 }));
    const series = buildSeries(points, whole(points));
    const total = haversineMeters(points[0]!, points[10]!);
    expect(series.segmentDistanceM).toBe(Math.round(total));
    // 111 м → 4 ячейки по ~27,8 м
    expect(series.distanceM).toHaveLength(Math.floor(total / SERIES_MIN_BIN_M));
    expect(series.distanceM.at(-1)).toBe(Math.round(total));
    expect(series.heartRate).toHaveLength(series.distanceM.length);
    expect(series.power).toHaveLength(series.distanceM.length);
    expect(series.speedKmh).toHaveLength(series.distanceM.length);
  });

  it('длинный сегмент — не больше SERIES_MAX_BINS ячеек; скорость по парам точек, 0,1 км/ч', () => {
    const points = line(5000, () => ({ hr: 140 }));
    const series = buildSeries(points, whole(points));
    expect(series.distanceM).toHaveLength(SERIES_MAX_BINS);
    const speed = (haversineMeters(points[0]!, points[1]!) / 1) * 3.6;
    for (const value of series.speedKmh) {
      expect(value).not.toBeNull();
      expect(Math.abs(value! - speed)).toBeLessThanOrEqual(0.1);
    }
    expect(series.summary.avgSpeedKmh).toBeCloseTo(speed, 0);
  });

  it('среднее пульса и мощности по точкам ячейки; сводка — средние и максимумы, целые', () => {
    // первая половина — 120 уд/мин и 100 Вт, вторая — 180 и 300
    const points = line(201, (i) => (i <= 100 ? { hr: 120, power: 100 } : { hr: 180, power: 300 }));
    const series = buildSeries(points, whole(points));
    expect(series.heartRate![0]).toBe(120);
    expect(series.heartRate!.at(-1)).toBe(180);
    expect(series.power![0]).toBe(100);
    expect(series.power!.at(-1)).toBe(300);
    expect(series.summary).toMatchObject({ maxHeartRate: 180, maxPower: 300 });
    expect(series.summary.avgHeartRate).toBe(150);
    expect(series.summary.avgPower).toBe(200);
    expect(Number.isInteger(series.summary.avgHeartRate)).toBe(true);
  });

  it('только точки сегмента: до старта и после финиша не входят', () => {
    const points = line(300, (i) => ({ hr: i < 100 || i > 200 ? 200 : 130 }));
    const series = buildSeries(points, {
      startedAt: points[100]!.time!,
      finishedAt: points[200]!.time!,
    });
    expect(series.summary.maxHeartRate).toBe(130);
    expect(series.segmentDistanceM).toBe(Math.round(haversineMeters(points[100]!, points[200]!)));
  });

  it('нет датчика в сегменте — ряд null; ячейка без значений — null внутри ряда', () => {
    const noSensors = line(50);
    const bare = buildSeries(noSensors, whole(noSensors));
    expect(bare.heartRate).toBeNull();
    expect(bare.power).toBeNull();
    expect(bare.summary).toMatchObject({
      avgHeartRate: null,
      maxHeartRate: null,
      avgPower: null,
      maxPower: null,
    });
    // пульс пропал на второй половине
    const gap = line(201, (i) => (i <= 100 ? { hr: 140 } : {}));
    const partial = buildSeries(gap, whole(gap));
    expect(partial.heartRate![0]).toBe(140);
    expect(partial.heartRate!.at(-1)).toBeNull();
  });

  it('меньше двух точек в сегменте — пустые ряды', () => {
    const points = line(10, () => ({ hr: 150 }));
    const series = buildSeries(points, {
      startedAt: new Date(T0 + 3500),
      finishedAt: new Date(T0 + 4200),
    });
    expect(series).toMatchObject({
      segmentDistanceM: 0,
      distanceM: [],
      heartRate: null,
      power: null,
      speedKmh: [],
    });
  });

  it('стоянка внутри ячейки — время пары входит в скорость, без деления на ноль', () => {
    const points = line(20);
    // 10 с стоим на точке 10
    const stopped = [
      ...points.slice(0, 11),
      ...Array.from({ length: 10 }, (_, k) => ({
        ...points[10]!,
        time: new Date(T0 + (11 + k) * 1000),
      })),
      ...points.slice(11).map((p) => ({ ...p, time: new Date(p.time!.getTime() + 10_000) })),
    ];
    const series = buildSeries(stopped, whole(stopped));
    expect(series.speedKmh.every((v) => v === null || Number.isFinite(v))).toBe(true);
    expect(Math.min(...series.speedKmh.map((v) => v ?? Infinity))).toBeLessThan(40);
  });
});

describe('analyzeSeries (вход worker)', () => {
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

  it('GPX с пульсом: ряд пульса и скорости, мощности нет; без координат и времени в итоге', () => {
    const series = analyzeSeries(
      fixture('garmin-connect.gpx'),
      'gpx',
      { startedAt: new Date('2026-06-14T06:00:00Z'), finishedAt: new Date('2026-06-15T00:00:00Z') },
      new Date('2026-10-25T12:00:00Z'),
    );
    expect(series.distanceM.length).toBeGreaterThan(10);
    expect(series.heartRate!.some((v) => v !== null)).toBe(true);
    expect(series.power).toBeNull();
    expect(Object.keys(series).sort()).toEqual(
      ['distanceM', 'heartRate', 'power', 'segmentDistanceM', 'speedKmh', 'summary'].sort(),
    );
  });
});
