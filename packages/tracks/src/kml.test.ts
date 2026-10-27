import { readFileSync } from 'node:fs';

import { XMLValidator } from 'fast-xml-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseKml } from './kml.ts';
import { ROUTE_MAX_POINTS, TrackParseError } from './track.ts';

// фикстуры — scripts/generate-kml-fixtures.ts (раскладка экспорта Google My Maps и Google Earth Pro)
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const expected = JSON.parse(
  readFileSync(new URL('./__fixtures__/expected.json', import.meta.url), 'utf8'),
) as Record<string, { points: number }>;
const options = { maxPoints: ROUTE_MAX_POINTS };

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseKml', () => {
  it('Google My Maps: точки линии в порядке, метки Point не попали, высоты 0 удалены', () => {
    const { points } = parseKml(fixture('route-mymaps.kml'), options);
    expect(points).toHaveLength(expected['route-mymaps.kml']!.points);
    expect(points[0]).toEqual({ lon: 27.52, lat: 53.88 });
    expect(points[1]!.lon).toBeGreaterThan(points[0]!.lon);
    expect(points.some((point) => point.lon === 27.5 && point.lat === 53.9)).toBe(false);
    expect(points.every((point) => point.ele === undefined)).toBe(true);
  });

  it('Google Earth: gx:Track — gx:coord с высотами, when не нужен', () => {
    const { points } = parseKml(fixture('route-earth-gxtrack.kml'), options);
    expect(points).toHaveLength(expected['route-earth-gxtrack.kml']!.points);
    expect(points[0]).toEqual({ lon: 27.45, lat: 53.93, ele: 210 });
    expect(points.every((point) => point.time === undefined)).toBe(true);
  });

  it('MultiGeometry: обе LineString склеены в порядке документа, Point пропущен', () => {
    const { points } = parseKml(fixture('route-multigeometry.kml'), options);
    expect(points).toHaveLength(expected['route-multigeometry.kml']!.points);
    expect(points[59]!.lon).toBeLessThan(points[60]!.lon);
    expect(points[60]).toEqual({ lon: 27.54, lat: 53.9, ele: 215 });
  });

  it('LineString и gx:Track вперемешку — порядок документа', () => {
    const kml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
      <Placemark><gx:Track><gx:coord>27.1 53.1 5</gx:coord><gx:coord>27.2 53.2 6</gx:coord></gx:Track></Placemark>
      <Folder><Placemark><LineString><coordinates>27.3,53.3,7 27.4,53.4,8</coordinates></LineString></Placemark></Folder>
      <Placemark><gx:MultiTrack><gx:Track><gx:coord>27.5 53.5</gx:coord></gx:Track></gx:MultiTrack></Placemark>
    </Document></kml>`;
    expect(parseKml(kml, options).points.map((point) => point.lon)).toEqual([
      27.1, 27.2, 27.3, 27.4, 27.5,
    ]);
  });

  it('без высот; Polygon/LinearRing игнорируются; нечисловые кортежи пропущены', () => {
    const { points } = parseKml(fixture('route-no-alt.kml'), options);
    expect(points).toHaveLength(expected['route-no-alt.kml']!.points);
    expect(points.every((point) => point.ele === undefined)).toBe(true);

    const kml = `<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>1,1 2,2 3,3 1,1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><LineString><coordinates>27.1,53.1 x,y 27.2 27.3,53.3</coordinates></LineString></Placemark></kml>`;
    expect(parseKml(kml, options).points).toEqual([
      { lon: 27.1, lat: 53.1 },
      { lon: 27.3, lat: 53.3 },
    ]);
  });

  it('только метки и пустой документ — без точек', () => {
    expect(parseKml(fixture('route-points-only.kml'), options).points).toEqual([]);
    expect(parseKml(fixture('empty.kml'), options).points).toEqual([]);
  });

  it.each(['xxe.kml', 'billion-laughs.kml'])('%s — unreadable до парсера', (name) => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    expect(failureCode(() => parseKml(fixture(name), options))).toBe('unreadable');
    expect(validate).not.toHaveBeenCalled();
  });

  it('битый XML и не KML — unreadable', () => {
    expect(failureCode(() => parseKml('<kml><Placemark><LineString>', options))).toBe('unreadable');
    expect(failureCode(() => parseKml('<gpx></gpx>', options))).toBe('unreadable');
  });

  it('gx:coord больше предела — too_many_points подсчётом до разбора', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    const coords = '<gx:coord>27.5 53.9</gx:coord>'.repeat(11);
    expect(
      failureCode(() => parseKml(`<kml><gx:Track>${coords}</gx:Track></kml>`, { maxPoints: 10 })),
    ).toBe('too_many_points');
    expect(validate).not.toHaveBeenCalled();
  });

  it('кортежей coordinates больше предела (в сумме по линиям) — too_many_points', () => {
    const line = (count: number) =>
      `<LineString><coordinates>${Array.from({ length: count }, (_, i) => `27.${i},53.9`).join(' ')}</coordinates></LineString>`;
    expect(failureCode(() => parseKml(`<kml>${line(6)}${line(5)}</kml>`, { maxPoints: 10 }))).toBe(
      'too_many_points',
    );
    expect(parseKml(`<kml>${line(5)}${line(5)}</kml>`, { maxPoints: 10 }).points).toHaveLength(10);
    // предел маршрута — синтетика в памяти
    const big = `<kml>${line(ROUTE_MAX_POINTS + 1)}</kml>`;
    expect(failureCode(() => parseKml(big, options))).toBe('too_many_points');
  });
});
