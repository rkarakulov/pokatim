import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseGpx } from './gpx.ts';
import { sanitizePoints } from './points.ts';
import { summarizeTrack } from './summary.ts';
import { TrackParseError } from './track.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const ref = (
  JSON.parse(readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8')) as {
    gpx: { distanceM: number; elapsedSec: number; points: number };
  }
).gpx;

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

const minimal = (type: string) =>
  `<gpx><trk><type>${type}</type><trkseg><trkpt lat="53.9" lon="27.5"/></trkseg></trk></gpx>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseGpx', () => {
  it('Garmin Connect: cycling, пульс и каденс из TrackPointExtension, без мощности', () => {
    const track = parseGpx(fixture('garmin-connect.gpx'));
    expect(track.format).toBe('gpx');
    expect(track.sport).toBe('cycling');
    expect(track.hasHeartRate).toBe(true);
    expect(track.hasPower).toBe(false);
    expect(track.points).toHaveLength(ref.points);
    expect(track.points[1]).toMatchObject({ hr: expect.any(Number), cadence: expect.any(Number) });

    const summary = summarizeTrack(sanitizePoints(track.points));
    expect(Math.abs(summary.distanceM - ref.distanceM) / ref.distanceM).toBeLessThan(0.01);
    expect(summary.elapsedSec).toBe(ref.elapsedSec);
    expect(summary.elevationGainM).toBeGreaterThan(20);
  });

  it('Komoot: без расширений и <type> — unknown, без флагов', () => {
    const track = parseGpx(fixture('komoot.gpx'));
    expect(track.sport).toBe('unknown');
    expect(track.hasHeartRate).toBe(false);
    expect(track.hasPower).toBe(false);
    expect(track.points).toHaveLength(ref.points);
    expect(track.points[0]!.time).toEqual(new Date('2026-06-14T06:00:00Z'));
  });

  it('Strava: <type>1</type> — cycling, мощность и пульс', () => {
    const track = parseGpx(fixture('strava.gpx'));
    expect(track.sport).toBe('cycling');
    expect(track.hasPower).toBe(true);
    expect(track.hasHeartRate).toBe(true);
  });

  it('спорт по <type>', () => {
    expect(parseGpx(minimal('road_biking')).sport).toBe('cycling');
    expect(parseGpx(minimal(' Ride ')).sport).toBe('cycling');
    expect(parseGpx(minimal('running')).sport).toBe('other');
    expect(parseGpx(minimal('9')).sport).toBe('other');
    expect(parseGpx(minimal('kitesurfing')).sport).toBe('unknown');
  });

  it('без <time>: точки без времени', () => {
    const track = parseGpx(fixture('no-time.gpx'));
    expect(track.points).toHaveLength(ref.points);
    expect(track.points.every((point) => point.time === undefined)).toBe(true);
  });

  it('пустой <trk>: маршрут и путевые точки треком не считаются', () => {
    expect(parseGpx(fixture('empty-trk.gpx')).points).toEqual([]);
  });

  it('точки (0,0) приходят как есть — их отбрасывает sanitizePoints', () => {
    const track = parseGpx(fixture('zero-points.gpx'));
    expect(track.points).toHaveLength(ref.points);
    expect(sanitizePoints(track.points).length).toBe(Math.ceil(ref.points / 3));
  });

  it('BOM-строка и разметка внутри значения не ломают разбор', () => {
    const track = parseGpx(
      '﻿<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="53.9" lon="27.5"><ele>1&amp;2</ele></trkpt></trkseg></trk></gpx>',
    );
    expect(track.points).toEqual([{ lat: 53.9, lon: 27.5 }]);
  });

  it('невалидный XML, не GPX — unreadable', () => {
    expect(failureCode(() => parseGpx('<gpx><trk>'))).toBe('unreadable');
    expect(failureCode(() => parseGpx('<gpx><trk></gpx>'))).toBe('unreadable');
    expect(failureCode(() => parseGpx('<kml></kml>'))).toBe('unreadable');
    expect(failureCode(() => parseGpx('просто текст'))).toBe('unreadable');
  });

  it.each(['xxe.gpx', 'billion-laughs.gpx'])('%s — отказ быстро и без сети', (name) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const text = fixture(name);
    const started = performance.now();
    expect(failureCode(() => parseGpx(text))).toBe('unreadable');
    expect(performance.now() - started).toBeLessThan(100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('<!ENTITY без DOCTYPE и регистр не важен', () => {
    expect(failureCode(() => parseGpx('<!entity a "b"><gpx/>'))).toBe('unreadable');
    expect(failureCode(() => parseGpx('<?xml version="1.0"?><!doctype gpx><gpx/>'))).toBe(
      'unreadable',
    );
  });
});
