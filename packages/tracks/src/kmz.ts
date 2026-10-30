// Разбор KMZ (zip с KML) на `node:zlib` — только серверный вход `parse.ts` (worker), не лёгкий `index.ts`.
import { crc32, inflateRawSync } from 'node:zlib';

import { TrackParseError } from './track.ts';

/**
 * Предел распакованного KML из KMZ, байт (`[ASSUMPTION]` routes-formats RC-4): 50 000 точек KML — ≤ ~5–8 МБ;
 * больше — `unreadable` (zip-бомба, память потока разбора).
 */
export const ROUTE_KMZ_MAX_KML_BYTES = 16 * 1024 * 1024;

/** Записей central directory больше — `unreadable` (KMZ Google Earth — единицы файлов). */
const KMZ_MAX_ENTRIES = 1000;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  diskStart: number;
  localOffset: number;
}

const unreadable = () => new TrackParseError('unreadable');

/**
 * KML из KMZ (routes-formats, RC-5): EOCD (поиск с конца, последние 22 + 65 535 байт) → central directory → запись
 * `doc.kml` в корне (без учёта регистра), иначе первая `*.kml` в корне по порядку central directory (правило KMZ
 * Google; «в корне» — без `/` и `\`). Данные — по смещению локального заголовка с его длинами имени и extra; размеры
 * и CRC — из central directory (флаг 3: нули в локальном заголовке). Метод 0 — срез, 8 — `inflateRawSync` с
 * `maxOutputLength`. `unreadable`: нет EOCD, многотомность, zip64, записей > 1000, шифрование, другой метод, нет
 * KML, объявленный или фактический размер > `maxBytes`, CRC не совпал, выход за границы. Остальные файлы архива не
 * читаются; на диск ничего не пишется.
 */
export function kmlFromKmz(bytes: Uint8Array, maxBytes = ROUTE_KMZ_MAX_KML_BYTES): Uint8Array {
  try {
    return extract(bytes, maxBytes);
  } catch (error) {
    if (error instanceof TrackParseError) throw error;
    // RangeError DataView (выход за границы), ошибки zlib (битый поток, maxOutputLength)
    throw unreadable();
  }
}

function extract(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE) throw unreadable();
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0 || diskEntries !== entries) throw unreadable();
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw unreadable();
  if (entries > KMZ_MAX_ENTRIES || cdOffset + cdSize > eocd) throw unreadable();

  const central = readCentral(view, bytes, cdOffset, entries);
  const root = central.filter((entry) => !/[/\\]/.test(entry.name));
  const entry =
    root.find((item) => item.name.toLowerCase() === 'doc.kml') ??
    root.find((item) => item.name.toLowerCase().endsWith('.kml'));
  if (entry === undefined) throw unreadable();
  return entryData(view, bytes, entry, maxBytes);
}

/**
 * EOCD — с конца: подпись и длина комментария, сходящаяся с концом файла (`offset + 22 + commentLength = length`).
 * Подпись `PK\x05\x06` внутри комментария архива — не EOCD, поиск идёт дальше к началу.
 */
function findEocd(view: DataView): number {
  const last = view.byteLength - EOCD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at -= 1) {
    if (
      view.getUint32(at, true) === EOCD_SIGNATURE &&
      at + EOCD_SIZE + view.getUint16(at + 20, true) === view.byteLength
    ) {
      return at;
    }
  }
  throw unreadable();
}

function readCentral(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  count: number,
): CentralEntry[] {
  const result: CentralEntry[] = [];
  let at = offset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw unreadable();
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const nameEnd = at + CENTRAL_SIZE + nameLength;
    if (nameEnd > bytes.length) throw unreadable();
    result.push({
      // имена KML — ASCII; CP437 и UTF-8 (бит 11) для них совпадают
      name: new TextDecoder('utf-8').decode(bytes.subarray(at + CENTRAL_SIZE, nameEnd)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      diskStart: view.getUint16(at + 34, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at = nameEnd + extraLength + commentLength;
  }
  return result;
}

function entryData(
  view: DataView,
  bytes: Uint8Array,
  entry: CentralEntry,
  maxBytes: number,
): Uint8Array {
  if ((entry.flags & 0x01) !== 0) throw unreadable(); // шифрование
  if (entry.method !== 0 && entry.method !== 8) throw unreadable();
  if (
    entry.compressedSize === 0xffffffff ||
    entry.uncompressedSize === 0xffffffff ||
    entry.localOffset === 0xffffffff ||
    entry.diskStart !== 0
  ) {
    throw unreadable(); // zip64, многотомность
  }
  if (entry.uncompressedSize > maxBytes) throw unreadable();
  const local = entry.localOffset;
  if (view.getUint32(local, true) !== LOCAL_SIGNATURE) throw unreadable();
  // длины имени и extra локального заголовка могут отличаться от центрального
  const start =
    local + LOCAL_SIZE + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw unreadable();
  const data = bytes.subarray(start, end);

  let out: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw unreadable();
    out = data;
  } else {
    // `maxOutputLength` — страховка от ложного размера в заголовке (RangeError → unreadable)
    out = new Uint8Array(inflateRawSync(data, { maxOutputLength: maxBytes }));
  }
  if (out.length !== entry.uncompressedSize || crc32(out) !== entry.crc) throw unreadable();
  return out;
}
