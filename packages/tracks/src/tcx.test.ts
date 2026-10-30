import { readFileSync } from 'node:fs';

import { XMLValidator } from 'fast-xml-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseTcx } from './tcx.ts';
import { ROUTE_MAX_POINTS, TrackParseError } from './track.ts';

// фикстуры — scripts/generate-route-format-fixtures.ts (раскладка курса Garmin Connect и активности Garmin)
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

const trackpoint = (lon: number, lat: number, ele?: number) =>
  `<Trackpoint><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position>${
    ele === undefined ? '' : `<AltitudeMeters>${ele}</AltitudeMeters>`
  }</Trackpoint>`;
const tcx = (body: string) =>
  `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">${body}</TrainingCenterDatabase>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseTcx', () => {
  it('курс Garmin Connect: точки Courses/Course/Track с высотами; Folders, CoursePoint и Lap не попали', () => {
    const { points } = parseTcx(fixture('route-garmin-course.tcx'), options);
    expect(points).toHaveLength(expected['route-garmin-course.tcx']!.points);
    expect(points[0]).toEqual({ lon: 27.56, lat: 53.9, ele: 200 });
    expect(points[1]!.lon).toBeGreaterThan(points[0]!.lon);
    // CoursePoint «Вода» (27.61, 53.91) — не точка маршрута
    expect(points.some((point) => point.lon === 27.61 && point.lat === 53.91)).toBe(false);
    // время, пульс и мощность не нужны
    expect(points.every((point) => point.time === undefined && point.hr === undefined)).toBe(true);
  });

  it('активность: все Track всех Lap в порядке документа, точки без Position пропущены', () => {
    const { points } = parseTcx(fixture('route-garmin-activity.tcx'), options);
    expect(points).toHaveLength(expected['route-garmin-activity.tcx']!.points);
    expect(points[0]).toEqual({ lon: 27.5, lat: 53.88, ele: 215 });
    expect(points[100]!.lon).toBe(27.56); // второй Track первого круга
    expect(points[150]!.lon).toBe(27.59); // Track второго круга
    expect(points.every((point) => point.power === undefined)).toBe(true);
  });

  it('активности, затем курсы; несколько Course и Activity — порядок документа', () => {
    const text = tcx(
      `<Activities><Activity><Lap><Track>${trackpoint(27.1, 53.1)}</Track></Lap></Activity>` +
        `<Activity><Lap><Track>${trackpoint(27.2, 53.2)}</Track><Track>${trackpoint(27.3, 53.3)}</Track></Lap></Activity></Activities>` +
        `<Courses><Course><Name>a</Name><Track>${trackpoint(27.4, 53.4, 5)}</Track></Course>` +
        `<Course><Name>b</Name><Track>${trackpoint(27.5, 53.5)}${trackpoint(27.6, 53.6)}</Track></Course></Courses>`,
    );
    expect(parseTcx(text, options).points.map((point) => point.lon)).toEqual([
      27.1, 27.2, 27.3, 27.4, 27.5, 27.6,
    ]);
  });

  it('Position без широты или долготы, нечисловые координаты — пропуск; AltitudeMeters не число — без высоты', () => {
    const text = tcx(
      `<Courses><Course><Track>` +
        `<Trackpoint><Position><LatitudeDegrees>53.1</LatitudeDegrees></Position></Trackpoint>` +
        `<Trackpoint><Position><LatitudeDegrees>x</LatitudeDegrees><LongitudeDegrees>27</LongitudeDegrees></Position></Trackpoint>` +
        `<Trackpoint><Position><LatitudeDegrees>53.2</LatitudeDegrees><LongitudeDegrees>27.2</LongitudeDegrees></Position><AltitudeMeters>n/a</AltitudeMeters></Trackpoint>` +
        `</Track></Course></Courses>`,
    );
    expect(parseTcx(text, options).points).toEqual([{ lat: 53.2, lon: 27.2 }]);
  });

  it('без точек — points: []', () => {
    expect(parseTcx(fixture('route-no-points.tcx'), options).points).toEqual([]);
    expect(parseTcx(tcx(''), options).points).toEqual([]);
  });

  it('DTD и сущности — unreadable до разбора', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    expect(failureCode(() => parseTcx(fixture('route-dtd.tcx'), options))).toBe('unreadable');
    expect(validate).not.toHaveBeenCalled();
  });

  it('битая разметка и чужой корень — unreadable', () => {
    expect(failureCode(() => parseTcx(tcx('<Courses><Course>'), options))).toBe('unreadable');
    expect(failureCode(() => parseTcx('<gpx><trk/></gpx>', options))).toBe('unreadable');
  });

  it('Trackpoint больше предела — too_many_points подсчётом до разбора XML', () => {
    const validate = vi.spyOn(XMLValidator, 'validate');
    const text = tcx(
      `<Courses><Course><Track>${trackpoint(27.1, 53.1).repeat(11)}</Track></Course></Courses>`,
    );
    expect(failureCode(() => parseTcx(text, { maxPoints: 10 }))).toBe('too_many_points');
    expect(validate).not.toHaveBeenCalled();
    expect(parseTcx(text, { maxPoints: 11 }).points).toHaveLength(11);
  });
});
