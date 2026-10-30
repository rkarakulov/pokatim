import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseGpx } from './gpx.ts';
import { parseKml } from './kml.ts';
import { routeKml } from './route-kml.ts';
import { ROUTE_MAX_POINTS } from './track.ts';

const fixtureText = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const options = { maxPoints: ROUTE_MAX_POINTS };

describe('routeKml', () => {
  it('KML 2.2: один Placemark/LineString, `lon,lat[,ele]` — 6 и 1 знак; без name и стилей', () => {
    const kml = routeKml([
      { lat: 53.9, lon: 27.5, ele: 201.26 },
      { lat: 53.123_456_789, lon: 27.987_654_321 },
    ]);
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
    expect(kml.match(/<LineString>/g)).toHaveLength(1);
    expect(kml).toContain('27.500000,53.900000,201.3');
    // нет высоты — пара без третьей координаты
    expect(kml).toContain('27.987654,53.123457\n');
    for (const tag of ['<name', '<Style', '<description', '<ExtendedData']) {
      expect(kml).not.toContain(tag);
    }
  });

  it('altitudeMode: все точки с высотой — absolute (высоты над уровнем моря, не над рельефом); иначе — нет (clampToGround)', () => {
    const all = routeKml([
      { lat: 53.9, lon: 27.5, ele: 201 },
      { lat: 53.91, lon: 27.51, ele: 205 },
    ]);
    expect(all).toContain('<LineString><altitudeMode>absolute</altitudeMode><coordinates>');
    // часть точек без высоты: `absolute` поставил бы их на 0 м — режим по умолчанию (по рельефу), высоты остаются в
    // кортежах (профиль при обратном разборе)
    const partial = routeKml([
      { lat: 53.9, lon: 27.5, ele: 201 },
      { lat: 53.91, lon: 27.51 },
    ]);
    expect(partial).not.toContain('altitudeMode');
    expect(partial).toContain('27.500000,53.900000,201.0');
    expect(routeKml([{ lat: 53.9, lon: 27.5 }])).not.toContain('altitudeMode');
    expect(routeKml([])).not.toContain('altitudeMode');
    expect(parseKml(all, options).points).toEqual([
      { lat: 53.9, lon: 27.5, ele: 201 },
      { lat: 53.91, lon: 27.51, ele: 205 },
    ]);
    expect(parseKml(partial, options).points).toEqual([
      { lat: 53.9, lon: 27.5, ele: 201 },
      { lat: 53.91, lon: 27.51 },
    ]);
  });

  it('обратный разбор parseKml — те же точки с точностью округления', () => {
    const points = [
      { lat: 53.9, lon: 27.5, ele: 201.26 },
      { lat: 53.91, lon: 27.51, ele: 205 },
      { lat: 53.123_456_789, lon: 27.987_654_321, ele: 199.94 },
    ];
    expect(parseKml(routeKml(points), options).points).toEqual([
      { lat: 53.9, lon: 27.5, ele: 201.3 },
      { lat: 53.91, lon: 27.51, ele: 205 },
      { lat: 53.123457, lon: 27.987654, ele: 199.9 },
    ]);
  });

  it.each(['garmin-connect.gpx', 'strava.gpx'])(
    '%s: в выходе нет строк исходника (имя, время, датчики) — только числа',
    (name) => {
      const source = parseGpx(fixtureText(name));
      const kml = routeKml(source.points);
      for (const tag of ['<when', '<name', 'hr>', 'power', 'cad>', 'Синтетический']) {
        expect(kml).not.toContain(tag);
      }
      expect(parseKml(kml, options).points).toHaveLength(source.points.length);
    },
  );
});
