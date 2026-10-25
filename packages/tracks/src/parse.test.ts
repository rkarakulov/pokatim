import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { analyzeTrack, parseTrackFile, TrackParseError, TRACK_MAX_POINTS } from './parse.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const expected = JSON.parse(
  readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8'),
) as Record<string, { distanceM: number; elapsedSec?: number; points: number }>;
const NOW = new Date('2026-10-25T12:00:00Z');

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

describe('analyzeTrack', () => {
  it('Garmin Edge: сводка, линия и только сериализуемые значения без биометрии', () => {
    const ref = expected['garmin-edge-ride.fit']!;
    const result = analyzeTrack(fixture('garmin-edge-ride.fit'), 'fit', NOW);

    expect(result).toMatchObject({
      format: 'fit',
      sport: 'cycling',
      startedAt: new Date('2026-06-14T06:00:00Z'),
      elapsedSec: ref.elapsedSec,
      hasHeartRate: true,
      hasPower: true,
      sourcePointCount: ref.points,
    });
    expect(Math.abs(result.distanceM - ref.distanceM) / ref.distanceM).toBeLessThan(0.01);
    expect(result.startPoint[0]).toBeCloseTo(27.559, 5);
    expect(result.startPoint[1]).toBeCloseTo(53.9006, 5);
    expect(result.line.length).toBeGreaterThan(10);
    expect(result.line.length).toBeLessThanOrEqual(1000);
    expect(result.line[0]).toEqual(result.startPoint);

    expect(structuredClone(result)).toEqual(result);
    expect(Object.keys(result).sort()).toEqual(
      [
        'format',
        'sport',
        'startedAt',
        'endedAt',
        'elapsedSec',
        'movingSec',
        'distanceM',
        'elevationGainM',
        'hasHeartRate',
        'hasPower',
        'startPoint',
        'line',
        'sourcePointCount',
      ].sort(),
    );
  });

  it('GPX сквозной (BOM снимается при декодировании)', () => {
    const body = fixture('garmin-connect.gpx');
    const bom = new Uint8Array(body.length + 3);
    bom.set([0xef, 0xbb, 0xbf]);
    bom.set(body, 3);
    const result = analyzeTrack(bom, 'gpx', NOW);
    expect(result.format).toBe('gpx');
    expect(result.sport).toBe('cycling');
    expect(result.hasHeartRate).toBe(true);
    expect(
      Math.abs(result.distanceM - expected['gpx']!.distanceM) / expected['gpx']!.distanceM,
    ).toBeLessThan(0.01);
  });

  it.each([
    ['indoor-trainer.fit', 'no_track'],
    ['empty-trk.gpx', 'no_track'],
    ['no-time.gpx', 'no_timestamps'],
    ['zero-points.gpx', 'implausible'],
    ['reversed-time.gpx', 'implausible'],
    ['corrupted-crc.fit', 'unreadable'],
    ['truncated.fit', 'unreadable'],
    ['compressed-timestamp.fit', 'unreadable'],
    ['xxe.gpx', 'unreadable'],
    ['billion-laughs.gpx', 'unreadable'],
  ])('%s → %s', (name, code) => {
    const format = name.endsWith('.fit') ? 'fit' : 'gpx';
    expect(failureCode(() => analyzeTrack(fixture(name), format, NOW))).toBe(code);
  });

  it('формат документа не совпадает с сигнатурой — unreadable', () => {
    expect(failureCode(() => analyzeTrack(fixture('komoot.gpx'), 'fit', NOW))).toBe('unreadable');
    expect(failureCode(() => analyzeTrack(fixture('watch-run.fit'), 'gpx', NOW))).toBe(
      'unreadable',
    );
    expect(failureCode(() => analyzeTrack(fixture('watch-run.fit'), 'stream', NOW))).toBe(
      'unreadable',
    );
  });

  it('заезд «из будущего» относительно now — implausible', () => {
    expect(
      failureCode(() =>
        analyzeTrack(fixture('komoot.gpx'), 'gpx', new Date('2026-06-01T00:00:00Z')),
      ),
    ).toBe('implausible');
  });

  it(`больше ${TRACK_MAX_POINTS} точек — too_many_points`, () => {
    const point = '<trkpt lat="53.9" lon="27.5"><time>2026-06-14T06:00:00Z</time></trkpt>';
    const gpx = `<gpx><trk><trkseg>${point.repeat(TRACK_MAX_POINTS + 1)}</trkseg></trk></gpx>`;
    expect(failureCode(() => analyzeTrack(new TextEncoder().encode(gpx), 'gpx', NOW))).toBe(
      'too_many_points',
    );
  });

  it('бег: разбирается, спорт other (фильтр не-вело — за worker/API)', () => {
    expect(analyzeTrack(fixture('watch-run.fit'), 'fit', NOW).sport).toBe('other');
  });
});

describe('parseTrackFile', () => {
  it('формат по содержимому; не FIT/GPX — unreadable', () => {
    expect(parseTrackFile(fixture('wahoo-elemnt-ride.fit')).format).toBe('fit');
    expect(parseTrackFile(fixture('strava.gpx')).format).toBe('gpx');
    expect(failureCode(() => parseTrackFile(Uint8Array.of(0x50, 0x4b, 3, 4)))).toBe('unreadable');
    expect(failureCode(() => parseTrackFile(new Uint8Array()))).toBe('unreadable');
  });
});

describe('входы пакета', () => {
  it('лёгкий вход (index.ts) не тянет парсеры FIT/GPX и модули Node (только zod)', () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
        if (specifier === 'zod') continue;
        expect(specifier, `${file} → ${specifier}`).toMatch(/^\.\/[\w-]+\.ts$/);
        visit(specifier!);
      }
    };
    visit('./index.ts');
    expect(seen).not.toContain('./fit.ts');
    expect(seen).not.toContain('./gpx.ts');
    expect(seen).toContain('./simplify.ts');
    expect(seen).toContain('./stream.ts');
  });
});
