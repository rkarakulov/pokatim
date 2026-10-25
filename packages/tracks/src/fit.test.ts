import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFit } from './fit.ts';
import { sanitizePoints } from './points.ts';
import { summarizeTrack } from './summary.ts';
import { TrackParseError } from './track.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
interface Expected {
  distanceM: number;
  elapsedSec?: number;
  pauseSec?: number;
  elevationGainM?: number;
  points: number;
}
const expected = JSON.parse(
  readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8'),
) as Record<string, Expected>;

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

describe('parseFit', () => {
  it('Garmin Edge: спорт, флаги, точки, дистанция и время против эталона генератора (±1 %)', () => {
    const ref = expected['garmin-edge-ride.fit']!;
    const track = parseFit(fixture('garmin-edge-ride.fit'));
    expect(track.format).toBe('fit');
    expect(track.sport).toBe('cycling');
    expect(track.hasPower).toBe(true);
    expect(track.hasHeartRate).toBe(true);
    expect(track.points).toHaveLength(ref.points);
    expect(track.sessionStartedAt).toEqual(track.points[0]!.time);
    expect(track.sessionElapsedSec).toBe(ref.elapsedSec);

    const summary = summarizeTrack(sanitizePoints(track.points));
    expect(summary.distanceM).toBeGreaterThan(ref.distanceM * 0.99);
    expect(summary.distanceM).toBeLessThan(ref.distanceM * 1.01);
    expect(summary.elapsedSec).toBe(ref.elapsedSec);
    expect(summary.movingSec).toBeGreaterThanOrEqual(ref.elapsedSec! - ref.pauseSec! - 2);
    expect(summary.movingSec).toBeLessThanOrEqual(ref.elapsedSec! - ref.pauseSec!);
    expect(summary.elevationGainM).toBeGreaterThan(ref.elevationGainM! * 0.95);
    expect(summary.elevationGainM).toBeLessThan(ref.elevationGainM! * 1.05);
  });

  it('координаты переведены из semicircles в градусы', () => {
    const first = parseFit(fixture('garmin-edge-ride.fit')).points[0]!;
    expect(first.lat).toBeCloseTo(53.9006, 5);
    expect(first.lon).toBeCloseTo(27.559, 5);
  });

  it('Wahoo ELEMNT: пульс без мощности, developer-поля игнорируются', () => {
    const ref = expected['wahoo-elemnt-ride.fit']!;
    const track = parseFit(fixture('wahoo-elemnt-ride.fit'));
    expect(track.sport).toBe('cycling');
    expect(track.hasHeartRate).toBe(true);
    expect(track.hasPower).toBe(false);
    expect(track.points).toHaveLength(ref.points);
    expect(Object.keys(track.points[1]!).sort()).toEqual([
      'cadence',
      'ele',
      'hr',
      'lat',
      'lon',
      'time',
    ]);
    const summary = summarizeTrack(sanitizePoints(track.points));
    expect(Math.abs(summary.distanceM - ref.distanceM) / ref.distanceM).toBeLessThan(0.01);
  });

  it('бег с часов — other', () => {
    const track = parseFit(fixture('watch-run.fit'));
    expect(track.sport).toBe('other');
    expect(track.points).toHaveLength(expected['watch-run.fit']!.points);
  });

  it('две сессии: точки обеих, спорт — первой велосессии', () => {
    const ref = expected['two-sessions.fit']!;
    const track = parseFit(fixture('two-sessions.fit'));
    expect(track.sport).toBe('cycling');
    expect(track.points).toHaveLength(ref.points);
    const summary = summarizeTrack(sanitizePoints(track.points));
    expect(Math.abs(summary.distanceM - ref.distanceM) / ref.distanceM).toBeLessThan(0.01);
  });

  it('велостанок без GPS: cycling_indoor, точек с координатами нет, флаги есть', () => {
    const track = parseFit(fixture('indoor-trainer.fit'));
    expect(track.sport).toBe('cycling_indoor');
    expect(track.points).toEqual([]);
    expect(track.hasPower).toBe(true);
    expect(track.hasHeartRate).toBe(true);
  });

  it('сжатые метки времени: декодер SDK их не поддерживает — unreadable', () => {
    expect(failureCode(() => parseFit(fixture('compressed-timestamp.fit')))).toBe('unreadable');
  });

  it('битый CRC, усечённый файл, мусор — unreadable', () => {
    expect(failureCode(() => parseFit(fixture('corrupted-crc.fit')))).toBe('unreadable');
    expect(failureCode(() => parseFit(fixture('truncated.fit')))).toBe('unreadable');
    expect(failureCode(() => parseFit(fixture('komoot.gpx')))).toBe('unreadable');
    expect(failureCode(() => parseFit(new Uint8Array()))).toBe('unreadable');
  });
});
