import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { detectTrackFormat } from './format.ts';
import { precheckTrackFile } from './precheck.ts';
import { TRACK_FILE_MAX_BYTES } from './track.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const bytes = (text: string) => new TextEncoder().encode(text);

describe('detectTrackFormat', () => {
  it('FIT — по заголовку (14 и 12 байт)', () => {
    expect(detectTrackFormat(fixture('garmin-edge-ride.fit'))).toBe('fit');
    const header12 = new Uint8Array([12, 0x10, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54]);
    expect(detectTrackFormat(header12)).toBe('fit');
  });

  it('FIT с неверным размером заголовка или без .FIT — не FIT', () => {
    const header = fixture('garmin-edge-ride.fit').slice(0, 14);
    expect(detectTrackFormat(Uint8Array.of(13, ...header.slice(1)))).toBeNull();
    const noMagic = header.slice();
    noMagic[9] = 0x00;
    expect(detectTrackFormat(noMagic)).toBeNull();
  });

  it('GPX: с декларацией, с BOM, без декларации, с комментарием и PI перед корнем', () => {
    expect(detectTrackFormat(fixture('komoot.gpx'))).toBe('gpx');
    expect(
      detectTrackFormat(Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes('<?xml version="1.0"?>\n<gpx>'))),
    ).toBe('gpx');
    // решение: декларация необязательна (XML 1.0), корень <gpx> достаточен
    expect(detectTrackFormat(bytes('  \n<gpx version="1.1">'))).toBe('gpx');
    expect(
      detectTrackFormat(
        bytes(
          '<?xml version="1.0"?><!-- export --><?xml-stylesheet href="a"?>\n<gpx\n creator="x">',
        ),
      ),
    ).toBe('gpx');
  });

  it('не GPX: другой корень, DOCTYPE перед корнем, корень дальше 4 КБ, `<gpxfoo`', () => {
    expect(detectTrackFormat(bytes('<?xml version="1.0"?><kml></kml>'))).toBeNull();
    expect(detectTrackFormat(fixture('xxe.gpx'))).toBeNull();
    expect(detectTrackFormat(bytes(`<!--${' '.repeat(5000)}--><gpx>`))).toBeNull();
    expect(detectTrackFormat(bytes('<gpxfoo>'))).toBeNull();
  });

  it('PNG, ZIP, пустой, текст — null', () => {
    expect(
      detectTrackFormat(
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d),
      ),
    ).toBeNull();
    expect(
      detectTrackFormat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0, 0, 0, 0, 0)),
    ).toBeNull();
    expect(detectTrackFormat(new Uint8Array())).toBeNull();
    expect(detectTrackFormat(bytes('hello world'))).toBeNull();
  });
});

describe('precheckTrackFile', () => {
  it('расширение без учёта регистра', () => {
    expect(precheckTrackFile({ name: 'ride.FIT', size: 10 })).toBe('ok');
    expect(precheckTrackFile({ name: 'morning.ride.gpx', size: 10 })).toBe('ok');
    expect(precheckTrackFile({ name: 'ride.tcx', size: 10 })).toBe('extension');
    expect(precheckTrackFile({ name: 'fit', size: 10 })).toBe('extension');
    expect(precheckTrackFile({ name: 'ride.gpx.zip', size: 10 })).toBe('extension');
  });

  it('пустой и слишком большой', () => {
    expect(precheckTrackFile({ name: 'a.gpx', size: 0 })).toBe('empty');
    expect(precheckTrackFile({ name: 'a.gpx', size: TRACK_FILE_MAX_BYTES })).toBe('ok');
    expect(precheckTrackFile({ name: 'a.gpx', size: TRACK_FILE_MAX_BYTES + 1 })).toBe('too_large');
  });
});
