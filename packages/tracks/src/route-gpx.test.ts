import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseGpx } from './gpx.ts';
import { routeGpx } from './route-gpx.ts';

const fixtureText = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('routeGpx', () => {
  it('GPX 1.1: шапка, creator="Pokatim", один trk/trkseg; 6 знаков координат и 1 знак высоты', () => {
    const gpx = routeGpx([
      { lat: 53.9, lon: 27.5, ele: 201.26 },
      { lat: 53.123_456_789, lon: 27.987_654_321 },
    ]);
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(gpx).toContain(
      '<gpx version="1.1" creator="Pokatim" xmlns="http://www.topografix.com/GPX/1/1">',
    );
    expect(gpx.match(/<trk>/g)).toHaveLength(1);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(gpx).toContain('<trkpt lat="53.900000" lon="27.500000"><ele>201.3</ele></trkpt>');
    // нет высоты — без <ele>
    expect(gpx).toContain('<trkpt lat="53.123457" lon="27.987654"></trkpt>');
    expect(gpx.match(/<ele>/g)).toHaveLength(1);
  });

  it.each(['garmin-connect.gpx', 'strava.gpx'])(
    '%s: в выходе нет time, extensions, metadata, name и датчиков; снова разбирается parseGpx',
    (name) => {
      const source = parseGpx(fixtureText(name));
      const gpx = routeGpx(source.points);
      for (const tag of ['<time', '<extensions', '<metadata', '<name', 'hr>', 'power', 'cad>']) {
        expect(gpx).not.toContain(tag);
      }
      expect(gpx).not.toContain('Синтетический');
      const again = parseGpx(gpx, { allowRoute: true });
      expect(again.points).toHaveLength(source.points.length);
      expect(again.points[0]!.ele).toBe(source.points[0]!.ele);
    },
  );
});
