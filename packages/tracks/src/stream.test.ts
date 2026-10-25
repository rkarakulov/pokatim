import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  analyzeTrack,
  decodeTrackStream,
  encodeTrackStream,
  TRACK_STREAM_MAX_JSON_BYTES,
} from './parse.ts';
import { sanitizePoints } from './points.ts';
import { AGGREGATOR_CYCLING_TYPES, parseStream, TrackStreamV1 } from './stream.ts';
import { TRACK_STREAM_MAX_POINTS, TrackParseError } from './track.ts';

const NOW = new Date('2026-10-25T12:00:00Z');
const ref = (
  JSON.parse(readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8')) as {
    gpx: { distanceM: number; elapsedSec: number; points: number };
  }
).gpx;
const loadStream = (): TrackStreamV1 =>
  TrackStreamV1.parse(
    JSON.parse(readFileSync(new URL('./__fixtures__/ow-stream.json', import.meta.url), 'utf8')),
  );

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

describe('parseStream', () => {
  it('валидный поток: точки со временем из unix ms, высота null — без ele, спорт и флаги', () => {
    const stream = loadStream();
    const track = parseStream(stream);
    expect(track).toMatchObject({
      format: 'stream',
      sport: 'cycling',
      hasHeartRate: true,
      hasPower: false,
    });
    expect(track.points).toHaveLength(ref.points);
    expect(track.points[0]).toEqual({
      lat: 53.9006,
      lon: 27.559,
      time: new Date(stream.points[0]![0]),
    });
    expect(track.points[1]!.ele).toBe(200);
  });

  it.each([
    ['road_cycling', 'cycling'],
    ['E_Biking', 'cycling'],
    ['track_cycling', 'cycling'],
    ['virtual_cycling', 'cycling_indoor'],
    ['spinning', 'cycling_indoor'],
    ['running', 'other'],
    ['', 'unknown'],
  ])('спорт %s → %s', (sport, expected) => {
    expect(parseStream({ ...loadStream(), sport }).sport).toBe(expected);
  });

  it('AGGREGATOR_CYCLING_TYPES — все велотипы обеих групп', () => {
    expect([...AGGREGATOR_CYCLING_TYPES].sort()).toEqual(
      [
        'cycling',
        'road_cycling',
        'mountain_biking',
        'gravel_cycling',
        'cyclocross',
        'e_biking',
        'bmx',
        'track_cycling',
        'indoor_cycling',
        'virtual_cycling',
        'spinning',
      ].sort(),
    );
  });

  it('мусор и не та версия — unreadable', () => {
    const stream = loadStream();
    expect(failureCode(() => parseStream(null))).toBe('unreadable');
    expect(failureCode(() => parseStream('строка'))).toBe('unreadable');
    expect(failureCode(() => parseStream({ ...stream, v: 2 }))).toBe('unreadable');
    expect(failureCode(() => parseStream({ ...stream, points: [[1.5, 53.9, 27.5, null]] }))).toBe(
      'unreadable',
    );
    expect(failureCode(() => parseStream({ ...stream, points: [[1, 53.9, 27.5]] }))).toBe(
      'unreadable',
    );
    expect(failureCode(() => parseStream({ ...stream, provider: 'x'.repeat(41) }))).toBe(
      'unreadable',
    );
  });

  it(`больше ${TRACK_STREAM_MAX_POINTS} точек — too_many_points (до схемы)`, () => {
    const points = Array.from({ length: TRACK_STREAM_MAX_POINTS + 1 }, () => 0);
    expect(failureCode(() => parseStream({ ...loadStream(), points }))).toBe('too_many_points');
  });
});

describe('поток в analyzeTrack', () => {
  it('сквозной: encodeTrackStream → analyzeTrack(stream), дистанция против эталона', () => {
    const result = analyzeTrack(encodeTrackStream(loadStream()), 'stream', NOW);
    expect(result).toMatchObject({
      format: 'stream',
      sport: 'cycling',
      elapsedSec: ref.elapsedSec,
      hasHeartRate: true,
      hasPower: false,
      sourcePointCount: ref.points,
    });
    expect(Math.abs(result.distanceM - ref.distanceM) / ref.distanceM).toBeLessThan(0.01);
    expect(result.line.length).toBeGreaterThan(2);
  });

  it('координаты вне диапазона отбрасываются; больше половины — implausible', () => {
    const stream = loadStream();
    const spoil = (bad: (index: number) => boolean) => ({
      ...stream,
      points: stream.points.map((p, i): TrackStreamV1['points'][number] =>
        bad(i) ? [p[0], 95, 200, p[3]] : p,
      ),
    });
    const everyTenth = (i: number) => i % 10 === 1;
    const twoOfThree = (i: number) => i % 3 !== 0;
    const fewBad = analyzeTrack(encodeTrackStream(spoil(everyTenth)), 'stream', NOW);
    expect(fewBad.line.every(([lon, lat]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180)).toBe(
      true,
    );
    expect(sanitizePoints(parseStream(spoil(everyTenth)).points).length).toBe(ref.points - 91);
    expect(
      failureCode(() => analyzeTrack(encodeTrackStream(spoil(twoOfThree)), 'stream', NOW)),
    ).toBe('implausible');
  });

  it('немонотонное время: точки «назад» отбрасываются, обратный поток — implausible', () => {
    const stream = loadStream();
    const jittered = {
      ...stream,
      points: stream.points.map((p, i): TrackStreamV1['points'][number] =>
        i % 50 === 25 ? [p[0] - 60_000, p[1], p[2], p[3]] : p,
      ),
    };
    const result = analyzeTrack(encodeTrackStream(jittered), 'stream', NOW);
    expect(result.elapsedSec).toBe(ref.elapsedSec);
    expect(sanitizePoints(parseStream(jittered).points).length).toBe(ref.points - 18);

    const reversed = { ...stream, points: [...stream.points].reverse() };
    expect(failureCode(() => analyzeTrack(encodeTrackStream(reversed), 'stream', NOW))).toBe(
      'implausible',
    );
  });

  it(`больше ${TRACK_STREAM_MAX_POINTS} точек — too_many_points`, () => {
    const point = loadStream().points[1]!;
    const stream = {
      ...loadStream(),
      points: Array.from({ length: TRACK_STREAM_MAX_POINTS + 1 }, () => point),
    };
    expect(failureCode(() => analyzeTrack(encodeTrackStream(stream), 'stream', NOW))).toBe(
      'too_many_points',
    );
  });

  it('не gzip, gzip не JSON — unreadable', () => {
    expect(failureCode(() => decodeTrackStream(Uint8Array.of(1, 2, 3)))).toBe('unreadable');
    expect(failureCode(() => decodeTrackStream(gzipSync('{"v":1,')))).toBe('unreadable');
  });

  it('gzip-бомба: маленький архив, распаковка больше лимита — unreadable', () => {
    const bomb = gzipSync(Buffer.alloc(TRACK_STREAM_MAX_JSON_BYTES + 1024, 0x20));
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(failureCode(() => analyzeTrack(bomb, 'stream', NOW))).toBe('unreadable');
  });
});
