import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFit } from '../fit.ts';
import { trackLengthMeters } from '../geo.ts';
import { parseGpx } from '../gpx.ts';
import { sanitizePoints } from '../points.ts';
import { simplifyTrack } from '../simplify.ts';
import type { CorridorGeometry, ParsedPoint } from '../track.ts';
import { matchCorridor } from './match.ts';
import { CORRIDOR_ENGINE_VERSION } from './policy.ts';
import { prepareCorridor } from './prepare.ts';
import type { CorridorMatch, MatchWindow } from './types.ts';

interface FixtureCase {
  corridor: CorridorGeometry;
  window: { startsAt: string; closesAt: string };
  expected: {
    verdict: CorridorMatch['verdict'];
    reasons: string[];
    touchedCorridor: boolean;
    elapsedSec?: number;
    toleranceSec?: number;
    startedAt?: string;
    finishedAt?: string;
    momentToleranceMs?: number;
    coverage?: number;
    offCorridorShare?: number;
    maxExcursionM?: number;
    noisePoints?: number;
  };
}

const file = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url));
const expectedFile = JSON.parse(file('corridor/corridor-expected.json').toString('utf8')) as {
  engineVersion: number;
  fixtures: Record<string, FixtureCase>;
};
const gpxPoints = (name: string) =>
  sanitizePoints(parseGpx(file(`corridor/${name}`).toString('utf8')).points);
const toWindow = (window: FixtureCase['window']): MatchWindow => ({
  startsAt: new Date(window.startsAt),
  closesAt: new Date(window.closesAt),
});
const run = (name: string) => {
  const fixture = expectedFile.fixtures[name]!;
  return matchCorridor(
    gpxPoints(name),
    prepareCorridor(fixture.corridor),
    toWindow(fixture.window),
  );
};

/** AC по фикстурам — матрица spec §11. */
const SCENARIOS: Record<string, string> = {
  'clean.gpx': 'AC1 чистый проезд',
  'shortcut-800.gpx': 'AC3 срез 800 м',
  'shortcut-450.gpx': 'AC3 срез 450 м',
  'shortcut-500.gpx': 'AC3 срез ровно 500 м',
  'wobble-3pct.gpx': 'AC4 мелкие сходы 3 %',
  'wobble-1_5pct.gpx': 'AC4 мелкие сходы 1,5 %',
  'noisy.gpx': 'AC5 шум σ 15 м и 5 выбросов',
  'sparse-30s.gpx': 'AC6 точка раз в 30 с',
  'sparse-60s.gpx': 'AC6 точка раз в 60 с на 40 км/ч',
  'loop-1lap.gpx': 'AC7 петля, один круг',
  'loop-2laps.gpx': 'AC7 петля, два круга — лучший',
  'loop-loiter.gpx': 'AC7 петля, топтание на старте — последний выход',
  'outback-full.gpx': 'AC8 «туда-обратно» полностью',
  'outback-turn-7km.gpx': 'AC8 «туда-обратно», разворот на 7 км',
  'reverse-linear.gpx': 'AC9 обратное направление, линейный',
  'reverse-loop.gpx': 'AC9 обратное направление, петля',
  'gap-3km.gpx': 'AC10 разрыв GPS 3 км',
  'tunnel-600m.gpx': 'AC10 тоннель 600 м',
  'window-start-before.gpx': 'AC11 старт на 1 с раньше окна',
  'window-finish-at-close.gpx': 'AC11 финиш ровно в closesAt',
  'window-finish-before-close.gpx': 'AC11 финиш за 1 с до closesAt',
  'window-record-before.gpx': 'AC11 запись до окна, старт в окне',
  'gates-10s.gpx': 'AC12 интерполяция ворот, точка раз в 10 с',
  'mid-start.gpx': 'AC13 заезд с середины',
  'stop-80pct.gpx': 'AC13 остановка на 80 %',
  'far-away.gpx': 'AC13 заезд вдали от коридора',
};

describe('matchCorridor на фикстурах (corridor-expected.json)', () => {
  it('матрица полная: каждая фикстура описана и наоборот', () => {
    expect(Object.keys(expectedFile.fixtures).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });

  it.each(Object.entries(SCENARIOS))('%s — %s', (name) => {
    const { expected } = expectedFile.fixtures[name]!;
    const match = run(name);

    expect(match.engineVersion).toBe(CORRIDOR_ENGINE_VERSION);
    expect(match.verdict).toBe(expected.verdict);
    expect(match.reasons).toEqual(expected.reasons);
    expect(match.touchedCorridor).toBe(expected.touchedCorridor);
    if (expected.reasons[0] === 'no_start') {
      expect(match.segment).toBeNull();
      return;
    }
    const segment = match.segment!;
    expect(segment).not.toBeNull();
    if (expected.elapsedSec !== undefined) {
      expect(Math.abs(segment.elapsedSec - expected.elapsedSec)).toBeLessThanOrEqual(
        expected.toleranceSec!,
      );
      const moment = (actual: Date, reference: string) =>
        Math.abs(actual.getTime() - Date.parse(reference));
      expect(moment(segment.startedAt, expected.startedAt!)).toBeLessThanOrEqual(
        expected.momentToleranceMs!,
      );
      expect(moment(segment.finishedAt, expected.finishedAt!)).toBeLessThanOrEqual(
        expected.momentToleranceMs!,
      );
    }
    if (expected.coverage !== undefined) expect(segment.coverage).toBe(expected.coverage);
    if (expected.offCorridorShare !== undefined) {
      expect(Math.abs(segment.offCorridorShare - expected.offCorridorShare)).toBeLessThan(0.001);
    }
    if (expected.maxExcursionM !== undefined) {
      expect(Math.abs(segment.maxExcursionM - expected.maxExcursionM)).toBeLessThanOrEqual(1);
    }
    if (expected.noisePoints !== undefined) expect(segment.noisePoints).toBe(expected.noisePoints);
  });

  it('AC3: ровно 500 м — засчитано (строгое «больше»)', () => {
    const match = run('shortcut-500.gpx');
    expect(match.verdict).toBe('counted');
    expect(match.segment!.maxExcursionM).toBe(500);
  });
});

describe('реальный формат и инварианты результата', () => {
  const edge = parseFit(new Uint8Array(file('garmin-edge-ride.fit')));
  const edgePoints = sanitizePoints(edge.points);
  const edgeExpected = JSON.parse(file('expected.json').toString('utf8')) as Record<
    string,
    { elapsedSec: number; pauseSec: number }
  >;
  const line = simplifyTrack(edgePoints, 1, 20_000).map((p): [number, number] => [p.lon, p.lat]);
  const edgeCorridor: CorridorGeometry = {
    line,
    widthM: 50,
    isLoop: true,
    distanceM: trackLengthMeters(line.map(([lon, lat]) => ({ lon, lat }))),
  };
  const window: MatchWindow = {
    startsAt: new Date('2026-06-14T00:00:00Z'),
    closesAt: new Date('2026-06-15T00:00:00Z'),
  };

  it('AC2: Garmin Edge (FIT) против коридора по его линии — засчитан, пауза 120 с входит во время', () => {
    const match = matchCorridor(edgePoints, prepareCorridor(edgeCorridor), window);
    const { elapsedSec, pauseSec } = edgeExpected['garmin-edge-ride.fit']!;
    expect(match.verdict).toBe('counted');
    expect(match.segment!.coverage).toBe(1);
    expect(match.segment!.offCorridorM).toBe(0);
    // ворота отнимают ≤ 2 × 50 м на старте и финише (≥ 6 м/с) — меньше 20 с; без паузы было бы ≤ elapsed − 120
    expect(match.segment!.elapsedSec).toBeLessThanOrEqual(elapsedSec);
    expect(match.segment!.elapsedSec).toBeGreaterThan(elapsedSec - 20);
    expect(match.segment!.elapsedSec).toBeGreaterThan(elapsedSec - pauseSec);
  });

  it('AC15: два прогона — побитово одинаковый результат, версия алгоритма = эталону', () => {
    expect(expectedFile.engineVersion).toBe(CORRIDOR_ENGINE_VERSION);
    for (const name of ['clean.gpx', 'loop-2laps.gpx', 'outback-turn-7km.gpx', 'noisy.gpx']) {
      const first = run(name);
      const second = run(name);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(second).toEqual(first);
      expect(structuredClone(first)).toEqual(first);
    }
  });

  it('AC16: пульс и мощность не влияют на результат и не попадают в него', () => {
    expect(edge.hasHeartRate && edge.hasPower).toBe(true);
    const corridor = prepareCorridor(edgeCorridor);
    const stripped = edgePoints.map(({ lat, lon, ele, time }): ParsedPoint => ({
      lat,
      lon,
      ele,
      time,
    }));
    const withSensors = matchCorridor(edgePoints, corridor, window);
    expect(matchCorridor(stripped, corridor, window)).toEqual(withSensors);
    expect(Object.keys(withSensors).sort()).toEqual(
      ['candidates', 'engineVersion', 'reasons', 'segment', 'touchedCorridor', 'verdict'].sort(),
    );
    expect(Object.keys(withSensors.segment!).sort()).toEqual(
      [
        'coverage',
        'distanceM',
        'elapsedMs',
        'elapsedSec',
        'finishedAt',
        'maxExcursionM',
        'noisePoints',
        'offCorridorM',
        'offCorridorShare',
        'startedAt',
      ].sort(),
    );
  });
});
