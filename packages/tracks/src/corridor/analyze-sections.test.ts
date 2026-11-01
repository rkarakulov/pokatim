import { describe, expect, it } from 'vitest';

import {
  analyzeAttempt,
  analyzeSections,
  encodeTrackStream,
  ROUTE_SECTIONS_VERSION,
  TrackParseError,
} from '../parse.ts';
import type { ParsedPoint } from '../track.ts';
import { corridorOf, ride, T0, type Xy } from './__testing__/synthetic.ts';
import type { MatchWindow } from './types.ts';

const WINDOW: MatchWindow = {
  startsAt: new Date(T0 - 3_600_000),
  closesAt: new Date(T0 + 86_400_000),
};
const NOW = new Date(T0 + 2 * 86_400_000);
const SPEED = 8;

/** Маршрут на север 30 км (вершины раз в 100 м): участки 0–10, 10–20, 20–30 км. */
const ROUTE: Xy[] = Array.from({ length: 301 }, (_, i) => [0, i * 100]);
const corridor = corridorOf(ROUTE);

const streamOf = (points: ParsedPoint[]) =>
  encodeTrackStream({
    v: 1,
    provider: 'garmin',
    sport: 'road_cycling',
    hasHeartRate: false,
    hasPower: false,
    points: points.map((p) => [p.time!.getTime(), p.lat, p.lon, null]),
  });

const rideBytes = (path: Xy[]) => streamOf(ride(path, { speed: SPEED, intervalS: 5 }));

describe('analyzeSections: неизменённый движок на подлиниях участков', () => {
  it('полный проезд 30 км — все участки засчитаны, время ≈ длина / скорость, сумма < времени маршрута', () => {
    const bytes = rideBytes([
      [0, -95],
      [0, 30_095],
    ]);
    const result = analyzeSections(bytes, 'stream', corridor, WINDOW, NOW);
    expect(result.version).toBe(ROUTE_SECTIONS_VERSION);
    expect(result.items.map(({ fromM, toM, verdict }) => [fromM, toM, verdict])).toEqual([
      [0, 10_000, 'counted'],
      [10_000, 20_000, 'counted'],
      [20_000, 30_000, 'counted'],
    ]);
    // от выхода из ворот старта до входа в ворота финиша: 10 000 − 2 × 50 м
    for (const item of result.items) {
      expect(Math.abs(item.elapsedSec! - 9_900 / SPEED)).toBeLessThanOrEqual(10);
    }
    const route = analyzeAttempt(bytes, 'stream', corridor, WINDOW, NOW);
    expect(route.verdict).toBe('counted');
    const total = result.items.reduce((sum, item) => sum + item.elapsedSec!, 0);
    expect(total).toBeLessThan(route.segment!.elapsedSec);
  });

  it('остановка на 18 км из 30 — 1-й участок засчитан, 2-й и 3-й нет, маршрут не засчитан', () => {
    const bytes = rideBytes([
      [0, -95],
      [0, 18_000],
    ]);
    const result = analyzeSections(bytes, 'stream', corridor, WINDOW, NOW);
    expect(result.items.map((item) => item.verdict)).toEqual(['counted', 'rejected', 'rejected']);
    expect(result.items[0]!.elapsedSec).toBeGreaterThan(0);
    expect(result.items[1]!.elapsedSec).toBeNull();
    expect(result.items[2]!.elapsedSec).toBeNull();
    expect(analyzeAttempt(bytes, 'stream', corridor, WINDOW, NOW).verdict).toBe('rejected');
  });

  it('объезд в середине 2-го участка — 2-й не засчитан, 1-й и 3-й засчитаны', () => {
    const bytes = rideBytes([
      [0, -95],
      [0, 14_000],
      [2_000, 14_000],
      [2_000, 16_000],
      [0, 16_000],
      [0, 30_095],
    ]);
    const result = analyzeSections(bytes, 'stream', corridor, WINDOW, NOW);
    expect(result.items.map((item) => item.verdict)).toEqual(['counted', 'rejected', 'counted']);
  });

  it('«туда-обратно» 2 × 17 км по одной дороге: граница в развороте, все 4 участка засчитаны', () => {
    const there = Array.from({ length: 171 }, (_, i): Xy => [0, i * 100]);
    const outback = corridorOf([...there, ...there.slice(0, -1).reverse()], { isLoop: true });
    const bytes = rideBytes([
      [0, -95],
      [0, 17_000],
      [0, -95],
    ]);
    const result = analyzeSections(bytes, 'stream', outback, WINDOW, NOW);
    expect(result.items.map(({ fromM, toM, verdict }) => [fromM, toM, verdict])).toEqual([
      [0, 10_000, 'counted'],
      [10_000, 17_000, 'counted'],
      [17_000, 27_000, 'counted'],
      [27_000, 34_000, 'counted'],
    ]);
    // время каждого участка ≈ (длина − 2 × 50 м) / скорость: попытка с нужного прохода дороги
    for (const item of result.items) {
      expect(
        Math.abs(item.elapsedSec! - (item.toM - item.fromM - 100) / SPEED),
      ).toBeLessThanOrEqual(10);
    }
  });

  it('маршрут 8 км — участков нет, файл не разбирается', () => {
    const short = corridorOf(Array.from({ length: 81 }, (_, i): Xy => [0, i * 100]));
    const garbage = new Uint8Array([1, 2, 3]);
    expect(analyzeSections(garbage, 'gpx', short, WINDOW, NOW)).toEqual({
      version: ROUTE_SECTIONS_VERSION,
      items: [],
    });
  });

  it('негодный файл при маршруте ≥ 15 км — TrackParseError', () => {
    expect(() => analyzeSections(new Uint8Array([1, 2, 3]), 'gpx', corridor, WINDOW, NOW)).toThrow(
      TrackParseError,
    );
  });

  it('результат сериализуем (structured clone)', () => {
    const result = analyzeSections(
      rideBytes([
        [0, -95],
        [0, 30_095],
      ]),
      'stream',
      corridor,
      WINDOW,
      NOW,
    );
    expect(structuredClone(result)).toEqual(result);
  });
});
