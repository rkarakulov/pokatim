import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';

import { haversineMeters } from './geo.ts';
import { ROUTE_TCX_PACE_KMH, ROUTE_TCX_START, routeTcx } from './route-tcx.ts';
import { parseTcx } from './tcx.ts';
import { ROUTE_MAX_POINTS } from './track.ts';

const options = { maxPoints: ROUTE_MAX_POINTS };
const ordered = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  parseTagValue: false,
});

/** Имена дочерних элементов узла по порядку (`preserveOrder`). */
function childNames(xml: string, path: readonly string[]): string[] {
  let nodes = ordered.parse(xml) as Record<string, unknown>[];
  for (const name of path) {
    const node = nodes.find((item) => name in item);
    if (!node) return [];
    nodes = node[name] as Record<string, unknown>[];
  }
  return nodes.map((node) => Object.keys(node).find((key) => key !== ':@')!);
}

const values = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((match) => match[1]!);

/** Прямая на восток: `count` точек через ~66 м, с высотой у чётных. */
const line = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    lat: 53.9,
    lon: 27.5 + i * 0.001,
    ...(i % 2 === 0 ? { ele: 200 + i / 3 } : {}),
  }));

describe('routeTcx', () => {
  it('пространство имён v2, один Courses/Course с Name = Pokatim, порядок элементов по XSD (RC-11)', () => {
    const tcx = routeTcx(line(5));
    expect(tcx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(tcx).toContain(
      '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
    );
    const course = ['TrainingCenterDatabase', 'Courses', 'Course'];
    expect(childNames(tcx, ['TrainingCenterDatabase', 'Courses'])).toEqual(['Course']);
    expect(childNames(tcx, course)).toEqual(['Name', 'Lap', 'Track']);
    expect(values(tcx, 'Name')).toEqual(['Pokatim']);
    expect(childNames(tcx, [...course, 'Lap'])).toEqual([
      'TotalTimeSeconds',
      'DistanceMeters',
      'BeginPosition',
      'BeginAltitudeMeters',
      'EndPosition',
      'EndAltitudeMeters',
      'Intensity',
    ]);
    const trackpoints = childNames(tcx, [...course, 'Track']);
    expect(trackpoints).toEqual(Array(5).fill('Trackpoint'));
    expect(childNames(tcx, [...course, 'Track', 'Trackpoint'])).toEqual([
      'Time',
      'Position',
      'AltitudeMeters',
      'DistanceMeters',
    ]);
    expect(childNames(tcx, [...course, 'Track', 'Trackpoint', 'Position'])).toEqual([
      'LatitudeDegrees',
      'LongitudeDegrees',
    ]);
    expect(values(tcx, 'Intensity')).toEqual(['Active']);
  });

  it('Time: от 2000-01-01T00:00:00Z, строго растёт, целые секунды, условная скорость 24 км/ч', () => {
    expect(ROUTE_TCX_START).toBe('2000-01-01T00:00:00Z');
    expect(ROUTE_TCX_PACE_KMH).toBe(24);
    const points = line(50);
    const times = values(routeTcx(points), 'Time');
    expect(times[0]).toBe('2000-01-01T00:00:00Z');
    expect(times.every((time) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(time))).toBe(true);
    const seconds = times.map((time) => (Date.parse(time) - Date.parse(ROUTE_TCX_START)) / 1000);
    for (let i = 1; i < seconds.length; i += 1)
      expect(seconds[i]!).toBeGreaterThan(seconds[i - 1]!);
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1]!, points[i]!);
    expect(Math.abs(seconds.at(-1)! - total / (24 / 3.6))).toBeLessThanOrEqual(1);
  });

  it('точки ближе секунды пути — время всё равно растёт', () => {
    const near = Array.from({ length: 10 }, (_, i) => ({ lat: 53.9, lon: 27.5 + i * 0.000_01 }));
    const seconds = values(routeTcx(near), 'Time').map((time) => Date.parse(time) / 1000);
    for (let i = 1; i < seconds.length; i += 1)
      expect(seconds[i]!).toBeGreaterThan(seconds[i - 1]!);
  });

  it('DistanceMeters точки — накопленная; Lap — итоги (время, дистанция, начало и конец)', () => {
    const points = line(20);
    const tcx = routeTcx(points);
    const distances = values(tcx, 'DistanceMeters').map(Number);
    // первое — Lap, дальше — точки
    const [lapDistance, ...pointDistances] = distances;
    expect(pointDistances[0]).toBe(0);
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += haversineMeters(points[i - 1]!, points[i]!);
      expect(Math.abs(pointDistances[i]! - total)).toBeLessThanOrEqual(0.05);
    }
    expect(lapDistance).toBe(pointDistances.at(-1));
    const times = values(tcx, 'Time');
    const lapSeconds = Number(values(tcx, 'TotalTimeSeconds')[0]);
    expect(lapSeconds).toBe((Date.parse(times.at(-1)!) - Date.parse(times[0]!)) / 1000);
    expect(tcx).toContain(
      '<BeginPosition><LatitudeDegrees>53.900000</LatitudeDegrees><LongitudeDegrees>27.500000</LongitudeDegrees></BeginPosition>',
    );
    // последняя точка (i = 19) без высоты — EndAltitudeMeters нет
    expect(tcx).toContain('<BeginAltitudeMeters>200.0</BeginAltitudeMeters>');
    expect(tcx).not.toContain('<EndAltitudeMeters>');
  });

  it('обратный разбор parseTcx — те же точки (6 и 1 знак), без высоты — без AltitudeMeters', () => {
    const points = [
      { lat: 53.123_456_789, lon: 27.987_654_321, ele: 201.26 },
      { lat: 53.2, lon: 27.9 },
    ];
    expect(parseTcx(routeTcx(points), options).points).toEqual([
      { lat: 53.123457, lon: 27.987654, ele: 201.3 },
      { lat: 53.2, lon: 27.9 },
    ]);
  });

  it('только числа: нет строк исходника и названия маршрута', () => {
    const tcx = routeTcx(line(3));
    const strings = tcx
      .replace(/<[^>]+>/g, ' ')
      .split(/\s+/)
      .filter((token) => token !== '');
    expect(
      strings.every(
        (token) => token === 'Pokatim' || token === 'Active' || /^[\d.:TZ-]+$/.test(token),
      ),
    ).toBe(true);
  });

  it('20 000 точек с высотами — меньше 5 МБ', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({
      lat: 53.9 + Math.sin(i / 50) * 0.01,
      lon: 27.5 + i * 0.0003,
      ele: 200 + (i % 100),
    }));
    expect(new TextEncoder().encode(routeTcx(many)).byteLength).toBeLessThan(5_000_000);
  });
});
