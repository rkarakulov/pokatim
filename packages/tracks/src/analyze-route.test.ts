import { readFileSync } from 'node:fs';

import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it, vi } from 'vitest';

import { analyzeRoute, ROUTE_MAX_POINTS, TrackParseError } from './parse.ts';
import { simplifyTrack } from './simplify.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const expected = JSON.parse(
  readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8'),
) as Record<string, { distanceM: number; elevationGainM?: number; points: number }>;
const utf8 = (text: string) => new TextEncoder().encode(text);

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

/** Прямая на восток от (27.5, 53.9): `count` точек, `stepDeg` по долготе. */
const straight = (count: number, stepDeg: number) =>
  Array.from({ length: count }, (_, i) => [27.5 + i * stepDeg, 53.9] as const);
const trkGpx = (points: readonly (readonly [number, number])[]) =>
  `<gpx><trk><trkseg>${points.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`;

describe('analyzeRoute', () => {
  it('trk без времени: длина, набор, старт и финиш, не петля; только сериализуемые значения', () => {
    const ref = expected['route-trk-no-time.gpx']!;
    const result = analyzeRoute(fixture('route-trk-no-time.gpx'));

    expect(Math.abs(result.distanceM - ref.distanceM)).toBeLessThan(1);
    expect(Number.isInteger(result.distanceM)).toBe(true);
    // гистерезис 3 м: последние сантиметры подъёма не копятся
    expect(Math.abs(result.elevationGainM! - ref.elevationGainM!)).toBeLessThan(3);
    expect(result.isLoop).toBe(false);
    expect(result.sourcePointCount).toBe(ref.points);
    expect(result.start).toEqual([27.56, 53.9]);
    expect(result.finish[0]).toBeCloseTo(27.71, 6);
    expect(result.line[0]).toEqual(result.start);
    expect(result.line.at(-1)).toEqual(result.finish);
    expect(result.matchLine[0]).toEqual(result.start);
    expect(result.matchLine.at(-1)).toEqual(result.finish);
    expect(result.line.length).toBeLessThanOrEqual(1000);
    expect(result.matchLine.length).toBeLessThanOrEqual(20_000);
    expect(result.matchLine.length).toBeGreaterThanOrEqual(result.line.length);
    expect(structuredClone(result)).toEqual(result);
    expect(Object.keys(result).sort()).toEqual(
      [
        'distanceM',
        'elevationGainM',
        'isLoop',
        'start',
        'finish',
        'line',
        'matchLine',
        'sourcePointCount',
      ].sort(),
    );
  });

  it('rte с редкими точками (планировщик) — маршрут; линия сверки не уплотняется', () => {
    const ref = expected['route-rte.gpx']!;
    const result = analyzeRoute(fixture('route-rte.gpx'));
    expect(Math.abs(result.distanceM - ref.distanceM)).toBeLessThan(1);
    expect(result.sourcePointCount).toBe(ref.points);
    expect(result.matchLine.length).toBeLessThanOrEqual(ref.points);
    expect(result.elevationGainM).toBeGreaterThan(0);
  });

  it('trk и rte в одном файле — берётся только trk', () => {
    const trk = straight(20, 0.001);
    const gpx =
      `<gpx><rte><rtept lat="53.0" lon="27.0"/><rtept lat="53.5" lon="27.5"/></rte>` +
      `<trk><trkseg>${trk.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg></trk></gpx>`;
    const result = analyzeRoute(utf8(gpx));
    expect(result.sourcePointCount).toBe(20);
    expect(result.start).toEqual([27.5, 53.9]);
    expect(result.elevationGainM).toBeNull();
  });

  it('петля: старт и финиш ближе 200 м — isLoop', () => {
    const ref = expected['route-loop.gpx']!;
    const result = analyzeRoute(fixture('route-loop.gpx'));
    expect(result.isLoop).toBe(true);
    expect(Math.abs(result.distanceM - ref.distanceM)).toBeLessThan(1);
    expect(result.line.length).toBeGreaterThan(3);
  });

  it.each([
    ['route-short.gpx', 'too_short'],
    ['billion-laughs.gpx', 'unreadable'],
    ['xxe.gpx', 'unreadable'],
    // пустой <trk> без точек и <rte> из двух точек (~1,3 км) — маршрут из rte
    ['empty-trk.gpx', 'no-error'],
    ['zero-points.gpx', 'no-error'],
    ['garmin-edge-ride.fit', 'unreadable'],
  ])('%s → %s', (name, code) => {
    expect(failureCode(() => analyzeRoute(fixture(name)))).toBe(code);
  });

  it('нет точек — no_track; одна точка — no_track', () => {
    expect(failureCode(() => analyzeRoute(utf8('<gpx><trk><trkseg/></trk></gpx>')))).toBe(
      'no_track',
    );
    expect(failureCode(() => analyzeRoute(utf8(trkGpx(straight(1, 0)))))).toBe('no_track');
  });

  it('не GPX и битый XML — unreadable', () => {
    expect(failureCode(() => analyzeRoute(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).toBe(
      'unreadable',
    );
    expect(failureCode(() => analyzeRoute(utf8('<gpx><trk><trkseg><trkpt')))).toBe('unreadable');
  });

  it('длиннее 1000 км — too_long', () => {
    expect(failureCode(() => analyzeRoute(utf8(trkGpx(straight(200, 0.1)))))).toBe('too_long');
  });

  it('точек больше ROUTE_MAX_POINTS — too_many_points подсчётом до разбора XML (trkpt и rtept)', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    const points = straight(ROUTE_MAX_POINTS + 1, 0.00001);
    expect(failureCode(() => analyzeRoute(utf8(trkGpx(points))))).toBe('too_many_points');
    const rte = `<gpx><rte>${points.map(([lon, lat]) => `<rtept lat="${lat}" lon="${lon}"/>`).join('')}</rte></gpx>`;
    expect(failureCode(() => analyzeRoute(utf8(rte)))).toBe('too_many_points');
    expect(validate).not.toHaveBeenCalled();
    validate.mockRestore();
  });

  it('линия показа длиннее 1000 точек при допуске 5 м — допуск растёт, концы сохранены', () => {
    // синусоида (500 волн по ±33 м): при исходном допуске линии показа нужно больше 1000 точек
    const wave = Array.from(
      { length: 6000 },
      (_, i) => [27.5 + i * 0.00002, 53.9 + 0.0003 * Math.sin((i / 12) * 2 * Math.PI)] as const,
    );
    const points = wave.map(([lon, lat]) => ({ lon, lat }));
    expect(simplifyTrack(points, 5, Number.MAX_SAFE_INTEGER).length).toBeGreaterThan(1000);

    const result = analyzeRoute(utf8(trkGpx(wave)));
    expect(result.line.length).toBeLessThanOrEqual(1000);
    expect(result.line.length).toBeGreaterThan(100);
    expect(result.matchLine.length).toBeLessThanOrEqual(20_000);
    expect(result.line[0]).toEqual([27.5, 53.9]);
    expect(result.line.at(-1)).toEqual(result.finish);
    expect(result.matchLine.at(-1)).toEqual(result.finish);
  });

  it.each([
    ['route-mymaps.kml', null, false],
    ['route-no-alt.kml', null, false],
    ['route-earth-gxtrack.kml', 40, true],
    ['route-multigeometry.kml', 0, false],
  ])('KML %s: длина, набор %s, петля %s по эталону', (name, gain, isLoop) => {
    const ref = expected[name]!;
    const result = analyzeRoute(fixture(name));
    expect(Math.abs(result.distanceM - ref.distanceM)).toBeLessThan(1);
    expect(result.sourcePointCount).toBe(ref.points);
    if (gain === null) expect(result.elevationGainM).toBeNull();
    // гистерезис 3 м: на каждой вершине (их у петли две) теряется меньше 3 м
    else expect(gain - result.elevationGainM!).toBeGreaterThanOrEqual(0);
    if (gain !== null) expect(gain - result.elevationGainM!).toBeLessThan(6);
    expect(result.isLoop).toBe(isLoop);
    expect(structuredClone(result)).toEqual(result);
  });

  it.each([
    ['route-points-only.kml', 'no_track'],
    ['empty.kml', 'no_track'],
    ['xxe.kml', 'unreadable'],
    ['billion-laughs.kml', 'unreadable'],
    ['route.kmz', 'unreadable'],
  ])('%s → %s', (name, code) => {
    expect(failureCode(() => analyzeRoute(fixture(name)))).toBe(code);
  });
});
