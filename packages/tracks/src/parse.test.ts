import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as lightEntry from './index.ts';
import {
  analyzeAttempt,
  analyzeTrack,
  CORRIDOR_ENGINE_VERSION,
  encodeTrackStream,
  FLAGS_VERSION,
  matchCorridor,
  prepareCorridor,
  parseTrackFile,
  TrackParseError,
  TRACK_MAX_POINTS,
} from './parse.ts';

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
    // маршрут (rte) заездом не считается — разбор заездов не включает allowRoute
    ['route-rte.gpx', 'no_track'],
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
    // разбор 200 001 точки XML — секунды; под параллельной нагрузкой `pnpm check` — больше 5 с по умолчанию
  }, 60_000);

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

  it('движок сверки — только в серверном входе: лёгкий вход его не экспортирует', () => {
    for (const name of [
      'matchCorridor',
      'matchCorridorDetailed',
      'trackMapOf',
      'prepareCorridor',
      'analyzeAttempt',
      'CORRIDOR_POLICY',
      'CORRIDOR_ENGINE_VERSION',
      'CORRIDOR_REJECTIONS',
    ]) {
      expect(lightEntry, name).not.toHaveProperty(name);
    }
  });
});

describe('analyzeAttempt', () => {
  const corridorCase = (name: string) =>
    (
      JSON.parse(
        readFileSync(
          new URL('./__fixtures__/corridor/corridor-expected.json', import.meta.url),
          'utf8',
        ),
      ) as {
        fixtures: Record<
          string,
          {
            corridor: Parameters<typeof analyzeAttempt>[2];
            window: { startsAt: string; closesAt: string };
          }
        >;
      }
    ).fixtures[name]!;
  const windowOf = (window: { startsAt: string; closesAt: string }) => ({
    startsAt: new Date(window.startsAt),
    closesAt: new Date(window.closesAt),
  });

  it('файл → loadTrack → matchCorridor: засчитанный проезд, версия алгоритма', () => {
    const { corridor, window } = corridorCase('clean.gpx');
    const result = analyzeAttempt(
      fixture('corridor/clean.gpx'),
      'gpx',
      corridor,
      windowOf(window),
      NOW,
    );
    expect(result).toMatchObject({ verdict: 'counted', engineVersion: CORRIDOR_ENGINE_VERSION });
    expect(structuredClone(result)).toEqual(result);
  });

  it('race-results-07: датчики и флаги сегмента вне CorridorMatch; без сегмента — null и []', () => {
    const { corridor, window } = corridorCase('clean.gpx');
    const result = analyzeAttempt(
      fixture('corridor/clean.gpx'),
      'gpx',
      corridor,
      windowOf(window),
      NOW,
    );
    expect(result.sensors).toEqual({ hr: false, power: false, source: 'samples' });
    expect(result.flags).toEqual([]);
    expect(result.flagsVersion).toBe(FLAGS_VERSION);
    const midStart = corridorCase('mid-start.gpx');
    const noStart = analyzeAttempt(
      fixture('corridor/mid-start.gpx'),
      'gpx',
      midStart.corridor,
      windowOf(midStart.window),
      NOW,
    );
    expect(noStart.segment).toBeNull();
    expect(noStart).toMatchObject({ sensors: null, flags: [], flagsVersion: FLAGS_VERSION });
    // ключи результата движка не изменились (AC16): новые поля — только у AttemptAnalysis
    const { trackMap, sensors, flags, flagsVersion, ...match } = result;
    void [trackMap, sensors, flags, flagsVersion];
    expect(Object.keys(match).sort()).toEqual(
      Object.keys(matchCorridor([], prepareCorridor(corridor), windowOf(window))).sort(),
    );
  });

  it('поток агрегатора (Garmin/Wahoo): датчики — заявленные признаки тренировки (declared), флагов нет', () => {
    const { corridor, window } = corridorCase('clean.gpx');
    const points = parseTrackFile(fixture('corridor/clean.gpx')).points.map(
      (point): [number, number, number, number | null] => [
        point.time!.getTime(),
        point.lat,
        point.lon,
        point.ele ?? null,
      ],
    );
    const stream = (hasHeartRate: boolean, hasPower: boolean) =>
      encodeTrackStream({
        v: 1,
        provider: 'garmin',
        sport: 'cycling',
        hasHeartRate,
        hasPower,
        points,
      });
    const declared = analyzeAttempt(stream(true, false), 'stream', corridor, windowOf(window), NOW);
    expect(declared).toMatchObject({
      verdict: 'counted',
      sensors: { hr: true, power: false, source: 'declared' },
      flags: [],
      flagsVersion: FLAGS_VERSION,
    });
    expect(
      analyzeAttempt(stream(false, true), 'stream', corridor, windowOf(window), NOW).sensors,
    ).toEqual({ hr: false, power: true, source: 'declared' });
  });

  it('trackMap: позиции на той же линии, что analyzeTrack пишет в activity_tracks; без координат и времени', () => {
    const { corridor, window } = corridorCase('wobble-3pct.gpx');
    const bytes = fixture('corridor/wobble-3pct.gpx');
    const { line } = analyzeTrack(bytes, 'gpx', NOW);
    const result = analyzeAttempt(bytes, 'gpx', corridor, windowOf(window), NOW, line);
    const trackMap = result.trackMap!;
    expect(Object.keys(trackMap).sort()).toEqual(['linePoints', 'offRuns', 'segment']);
    expect(trackMap.linePoints).toBe(line.length);
    const [from, to] = trackMap.segment!;
    expect(from).toBeLessThan(to);
    expect(to).toBeLessThanOrEqual(line.length - 1);
    expect(trackMap.offRuns.length).toBeGreaterThan(0);
    for (const [a, b] of trackMap.offRuns) {
      expect(a).toBeGreaterThanOrEqual(from);
      expect(b).toBeLessThanOrEqual(to);
      expect(Math.round(a * 1000) / 1000).toBe(a);
    }
    expect(structuredClone(result)).toEqual(result);
    expect(JSON.stringify(trackMap)).not.toMatch(/T\d\d:|lon|lat/);
    // без линии (по умолчанию) — разметки нет, вердикт тот же
    const withoutLine = analyzeAttempt(bytes, 'gpx', corridor, windowOf(window), NOW);
    expect(withoutLine.trackMap).toBeNull();
    expect({ ...withoutLine, trackMap: result.trackMap }).toEqual(result);
  });

  it('trackMap: чистый проезд — сход пуст, сегмент задан; нет старта (mid-start) — null', () => {
    const clean = corridorCase('clean.gpx');
    const cleanBytes = fixture('corridor/clean.gpx');
    const counted = analyzeAttempt(
      cleanBytes,
      'gpx',
      clean.corridor,
      windowOf(clean.window),
      NOW,
      analyzeTrack(cleanBytes, 'gpx', NOW).line,
    );
    expect(counted.trackMap!.offRuns).toEqual([]);
    expect(counted.trackMap!.segment).not.toBeNull();
    const midStart = corridorCase('mid-start.gpx');
    const midBytes = fixture('corridor/mid-start.gpx');
    const noStart = analyzeAttempt(
      midBytes,
      'gpx',
      midStart.corridor,
      windowOf(midStart.window),
      NOW,
      analyzeTrack(midBytes, 'gpx', NOW).line,
    );
    expect(noStart.reasons).toEqual(['no_start']);
    expect(noStart.trackMap).toBeNull();
  });

  it('ошибки файла — TrackParseError, как у analyzeTrack; инварианты коридора — ошибка программиста', () => {
    const { corridor, window } = corridorCase('clean.gpx');
    expect(
      failureCode(() =>
        analyzeAttempt(fixture('corridor/clean.gpx'), 'fit', corridor, windowOf(window), NOW),
      ),
    ).toBe('unreadable');
    expect(
      failureCode(() =>
        analyzeAttempt(fixture('no-time.gpx'), 'gpx', corridor, windowOf(window), NOW),
      ),
    ).toBe('no_timestamps');
    expect(() =>
      analyzeAttempt(
        fixture('corridor/clean.gpx'),
        'gpx',
        { ...corridor, widthM: 5 },
        windowOf(window),
        NOW,
      ),
    ).toThrow(/corridor: widthM/);
  });
});
