import { readFileSync } from 'node:fs';

import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it, vi } from 'vitest';

import {
  analyzeRoute,
  deriveRoute,
  parseGpx,
  parseKml,
  parseTcx,
  ROUTE_DERIVED_VERSION,
  ROUTE_MAX_POINTS,
  ROUTE_XML_MAX_ELEMENTS,
  TrackParseError,
} from './parse.ts';
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
        'profile',
        'gpx',
        'kml',
        'tcx',
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
  ])('%s → %s', (name, code) => {
    expect(failureCode(() => analyzeRoute(fixture(name)))).toBe(code);
  });

  it.each([
    ['route-garmin-course.tcx', 30, false],
    ['route-garmin-activity.tcx', 0, false],
    ['route-earth.kmz', 40, true],
    ['route-no-doc.kmz', null, false],
  ])('TCX/KMZ %s: длина, набор %s, петля %s по эталону', (name, gain, isLoop) => {
    const ref = expected[name]!;
    const result = analyzeRoute(fixture(name));
    expect(Math.abs(result.distanceM - ref.distanceM)).toBeLessThan(1);
    expect(result.sourcePointCount).toBe(ref.points);
    if (gain === null) expect(result.elevationGainM).toBeNull();
    else expect(gain - result.elevationGainM!).toBeGreaterThanOrEqual(0);
    if (gain !== null) expect(gain - result.elevationGainM!).toBeLessThan(6);
    expect(result.isLoop).toBe(isLoop);
    expect(structuredClone(result)).toEqual(result);
  });

  it('KMZ Google Earth — тот же результат, что его doc.kml', () => {
    expect(analyzeRoute(fixture('route-earth.kmz'))).toEqual(
      analyzeRoute(fixture('route-earth-kmz/doc.kml')),
    );
  });

  it.each([
    ['route-no-points.tcx', 'no_track'],
    ['route-dtd.tcx', 'unreadable'],
    // битый zip без central directory — теперь KMZ по сигнатуре, отказ — разбором zip
    ['route.kmz', 'unreadable'],
    ['route-no-kml.kmz', 'unreadable'],
    ['route-encrypted.kmz', 'unreadable'],
    ['route-method12.kmz', 'unreadable'],
    ['route-bad-crc.kmz', 'unreadable'],
    ['route-bomb.kmz', 'unreadable'],
    ['route-bomb-lying.kmz', 'unreadable'],
    // KML внутри с DOCTYPE до корня — не KML для сканера пролога
    ['route-dtd-inside.kmz', 'unreadable'],
  ])('%s → %s', (name, code) => {
    expect(failureCode(() => analyzeRoute(fixture(name)))).toBe(code);
  });

  it('предел элементов XML маршрута — ROUTE_XML_MAX_ELEMENTS (ROUTE_MAX_POINTS × 20 = 1 млн), не предел треков', () => {
    expect(ROUTE_XML_MAX_ELEMENTS).toBe(ROUTE_MAX_POINTS * 20);
    expect(ROUTE_XML_MAX_ELEMENTS).toBe(1_000_000);
  });

  it.each([
    ['KML', (body: string) => `<kml><Document>${body}</Document></kml>`],
    ['GPX', (body: string) => `<gpx><trk><trkseg/></trk>${body}</gpx>`],
    [
      'TCX',
      (body: string) =>
        `<TrainingCenterDatabase><Courses>${body}</Courses></TrainingCenterDatabase>`,
    ],
  ])(
    '%s: пустых элементов больше предела маршрута — too_many_points подсчётом, без разбора в дерево',
    (_, wrap) => {
      const validate = vi.spyOn(XMLValidator, 'validate');
      // 1 000 001 элемент ≈ 4 МБ — меньше 5 МиБ файла; предел треков (4 млн) его бы пропустил
      const text = wrap('<a/>'.repeat(ROUTE_XML_MAX_ELEMENTS));
      expect(failureCode(() => analyzeRoute(utf8(text)))).toBe('too_many_points');
      expect(validate).not.toHaveBeenCalled();
      validate.mockRestore();
    },
  );

  it('KMZ: распакованный KML с 1,1 млн пустых элементов — too_many_points подсчётом, без разбора в дерево', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    expect(failureCode(() => analyzeRoute(fixture('route-many-elements.kmz')))).toBe(
      'too_many_points',
    );
    expect(failureCode(() => deriveRoute(fixture('route-many-elements.kmz')))).toBe(
      'too_many_points',
    );
    expect(validate).not.toHaveBeenCalled();
    validate.mockRestore();
  });

  it('TCX: Trackpoint больше ROUTE_MAX_POINTS — too_many_points подсчётом до разбора XML', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    const trackpoint =
      '<Trackpoint><Position><LatitudeDegrees>53.9</LatitudeDegrees><LongitudeDegrees>27.5</LongitudeDegrees></Position></Trackpoint>';
    const tcx = `<TrainingCenterDatabase><Courses><Course><Track>${trackpoint.repeat(ROUTE_MAX_POINTS + 1)}</Track></Course></Courses></TrainingCenterDatabase>`;
    expect(failureCode(() => analyzeRoute(utf8(tcx)))).toBe('too_many_points');
    expect(validate).not.toHaveBeenCalled();
    validate.mockRestore();
  });
});

describe('analyzeRoute: профиль высоты и очищенный GPX (routes-03)', () => {
  it.each(['route-loop.gpx', 'route-rte.gpx', 'route-trk-no-time.gpx'])(
    '%s: профиль от 0 до distanceM, GPX — точки линии сверки',
    (name) => {
      const result = analyzeRoute(fixture(name));
      const profile = result.profile!;
      expect(profile.length).toBeGreaterThanOrEqual(2);
      expect(profile.length).toBeLessThanOrEqual(300);
      expect(profile[0]![0]).toBe(0);
      expect(profile.at(-1)![0]).toBe(result.distanceM);
      const gpx = parseGpx(result.gpx, { allowRoute: true });
      expect(gpx.points.map((p) => [p.lon, p.lat])).toEqual(
        result.matchLine.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]),
      );
      expect(result.gpx).not.toContain('<name');
      expect(result.gpx).not.toContain('<metadata');
    },
  );

  it('маршрут без высот — profile: null, GPX без <ele>', () => {
    const result = analyzeRoute(utf8(trkGpx(straight(20, 0.001))));
    expect(result.profile).toBeNull();
    expect(result.gpx).not.toContain('<ele>');
    expect(result.gpx).toContain('<trkpt');
  });

  it('KML и TCX экспорта — из тех же точек линии сверки, что GPX; без строк исходника', () => {
    for (const name of ['route-loop.gpx', 'route-garmin-course.tcx', 'route-earth.kmz']) {
      const result = analyzeRoute(fixture(name));
      const rounded = result.matchLine.map(([lon, lat]) => [
        Number(lon.toFixed(6)),
        Number(lat.toFixed(6)),
      ]);
      const ofKml = parseKml(result.kml, { maxPoints: ROUTE_MAX_POINTS }).points;
      const ofTcx = parseTcx(result.tcx, { maxPoints: ROUTE_MAX_POINTS }).points;
      expect(ofKml.map((p) => [p.lon, p.lat])).toEqual(rounded);
      expect(ofTcx.map((p) => [p.lon, p.lat])).toEqual(rounded);
      for (const text of [result.kml, result.tcx]) {
        expect(text).not.toContain('Холм');
        expect(text).not.toContain('Кольцо');
      }
    }
  });

  it('deriveRoute ≡ { profile, gpx, kml, tcx } из analyzeRoute (GPX, KML, TCX, KMZ); отказы — те же коды', () => {
    expect(ROUTE_DERIVED_VERSION).toBe(2);
    for (const name of [
      'route-loop.gpx',
      'route-rte.gpx',
      'zero-points.gpx',
      'route-mymaps.kml',
      'route-earth-gxtrack.kml',
      'route-garmin-activity.tcx',
      'route-earth.kmz',
    ]) {
      const { profile, gpx, kml, tcx } = analyzeRoute(fixture(name));
      const derived = deriveRoute(fixture(name));
      expect(derived).toEqual({ profile, gpx, kml, tcx });
      expect(structuredClone(derived)).toEqual(derived);
    }
    expect(failureCode(() => deriveRoute(fixture('xxe.gpx')))).toBe('unreadable');
    expect(failureCode(() => deriveRoute(fixture('xxe.kml')))).toBe('unreadable');
    expect(failureCode(() => deriveRoute(fixture('route-dtd.tcx')))).toBe('unreadable');
    expect(failureCode(() => deriveRoute(fixture('route-bomb-lying.kmz')))).toBe('unreadable');
    expect(failureCode(() => deriveRoute(fixture('route-short.gpx')))).toBe('too_short');
    expect(failureCode(() => deriveRoute(fixture('garmin-edge-ride.fit')))).toBe('unreadable');
  });
});
