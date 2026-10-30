import { readFileSync } from 'node:fs';
import type * as zlib from 'node:zlib';
import { inflateRawSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { kmlFromKmz, ROUTE_KMZ_MAX_KML_BYTES } from './kmz.ts';
import { TrackParseError } from './track.ts';

// фикстуры — scripts/generate-route-format-fixtures.ts (zip собран там `deflateRawSync` + `crc32`, не кодом пакета)
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// распаковка — настоящая; шпион только записывает вызовы (доказательство работы `maxOutputLength`)
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof zlib>();
  return { ...actual, inflateRawSync: vi.fn(actual.inflateRawSync) };
});
const inflate = vi.mocked(inflateRawSync);
afterEach(() => {
  inflate.mockClear();
});

/** Архив с комментарием EOCD `comment` (длина — в поле EOCD): zip допускает до 65 535 байт комментария. */
function withComment(zip: Uint8Array, comment: Uint8Array): Uint8Array {
  const out = new Uint8Array(zip.length + comment.length);
  out.set(zip, 0);
  out.set(comment, zip.length);
  new DataView(out.buffer).setUint16(zip.length - 2, comment.length, true);
  return out;
}

const failureCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TrackParseError ? error.code : 'other-error';
  }
  return 'no-error';
};

describe('kmlFromKmz', () => {
  it('предел распакованного KML — 16 МиБ (RC-4)', () => {
    expect(ROUTE_KMZ_MAX_KML_BYTES).toBe(16 * 1024 * 1024);
  });

  it('Google Earth: doc.kml (deflate, флаг 3 — нули в локальном заголовке, extra только в локальном) = его KML', () => {
    const kml = kmlFromKmz(fixture('route-earth.kmz'));
    expect(text(kml)).toBe(
      readFileSync(new URL('./__fixtures__/route-earth-kmz/doc.kml', import.meta.url), 'utf8'),
    );
  });

  it('без doc.kml в корне: первый `.kml` в корне по central directory (без учёта регистра), KML в папке — нет', () => {
    const kml = text(kmlFromKmz(fixture('route-no-doc.kmz')));
    // Route.KML — 120 точек от 27.6; layers/doc.kml (27.4) и second.kml (27.7) не выбраны
    expect(kml).toContain('27.6,53.86');
    expect(kml).not.toContain('27.4,53.8');
    expect(kml).not.toContain('27.7,53.85');
  });

  it.each([
    ['route.kmz', 'нет EOCD (только локальный заголовок)'],
    ['route-no-kml.kmz', 'нет KML'],
    ['route-encrypted.kmz', 'шифрование'],
    ['route-method12.kmz', 'метод 12 (bzip2)'],
    ['route-zip64.kmz', 'маркер zip64'],
    ['route-bad-crc.kmz', 'CRC-32 не совпал'],
    ['route-bomb.kmz', 'объявленный размер больше предела'],
    ['route-bomb-lying.kmz', 'ложный размер, распаковка больше предела'],
  ])('%s (%s) — unreadable', (name) => {
    expect(failureCode(() => kmlFromKmz(fixture(name)))).toBe('unreadable');
  });

  it('комментарий архива с `PK\\x05\\x06` внутри — не EOCD (offset + 22 + длина комментария ≠ конец файла)', () => {
    const earth = fixture('route-earth.kmz');
    const expected = text(kmlFromKmz(earth));
    // ложная «запись EOCD» в комментарии: подпись и мусорные поля (central directory за границей файла)
    const fake = new Uint8Array(40).fill(0xff);
    fake.set([0x50, 0x4b, 0x05, 0x06], 4);
    expect(text(kmlFromKmz(withComment(earth, fake)))).toBe(expected);
    // комментарий, объявленный длиннее остатка файла — EOCD не найден
    const broken = withComment(earth, new Uint8Array(10));
    new DataView(broken.buffer).setUint16(earth.length - 2, 11, true);
    expect(failureCode(() => kmlFromKmz(broken))).toBe('unreadable');
  });

  it('ложный размер в central directory = пределу, реальный поток больше — отказ даёт maxOutputLength распаковки', () => {
    expect(failureCode(() => kmlFromKmz(fixture('route-bomb-lying.kmz')))).toBe('unreadable');
    expect(inflate).toHaveBeenCalledTimes(1);
    expect(inflate.mock.calls[0]![1]).toEqual({ maxOutputLength: ROUTE_KMZ_MAX_KML_BYTES });
    // распаковка оборвана пределом (RangeError ERR_BUFFER_TOO_LARGE), а не прошла целиком
    const result = inflate.mock.results[0]!;
    expect(result.type).toBe('throw');
    expect((result.value as { code?: string }).code).toBe('ERR_BUFFER_TOO_LARGE');
  });

  it('объявленный размер больше предела — отказ до распаковки', () => {
    expect(failureCode(() => kmlFromKmz(fixture('route-bomb.kmz')))).toBe('unreadable');
    expect(inflate).not.toHaveBeenCalled();
  });

  it('предел — параметр: тот же архив с меньшим пределом — unreadable', () => {
    const size = fixture('route-earth-kmz/doc.kml').length;
    expect(kmlFromKmz(fixture('route-earth.kmz'), size)).toHaveLength(size);
    expect(failureCode(() => kmlFromKmz(fixture('route-earth.kmz'), size - 1))).toBe('unreadable');
  });

  it('обрезанный архив, мусор, пусто — unreadable без исключений другого вида', () => {
    const earth = fixture('route-earth.kmz');
    for (const cut of [4, 30, 100, earth.length - 30, earth.length - 1]) {
      expect(failureCode(() => kmlFromKmz(earth.slice(0, cut)))).toBe('unreadable');
    }
    // смещение central directory за границей файла
    const broken = earth.slice();
    const view = new DataView(broken.buffer);
    view.setUint32(broken.length - 6, broken.length + 100, true);
    expect(failureCode(() => kmlFromKmz(broken))).toBe('unreadable');
    expect(failureCode(() => kmlFromKmz(new Uint8Array()))).toBe('unreadable');
    expect(failureCode(() => kmlFromKmz(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)))).toBe('unreadable');
  });
});
