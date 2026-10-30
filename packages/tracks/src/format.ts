import type { TrackFormat } from './track.ts';

/** Сколько байт начала файла смотрим в поисках корня XML (`<gpx`, `<kml`, `<TrainingCenterDatabase`). */
const XML_SNIFF_BYTES = 4096;

/**
 * Формат файла маршрута по содержимому (routes-02; routes-formats — KMZ и TCX): `detectTrackFormat` их не знает (TCX
 * заездов не поддерживается, ADR-0011).
 */
export type RouteFileFormat = 'gpx' | 'kml' | 'kmz' | 'tcx';

/**
 * Формат по содержимому (не по расширению).
 * FIT — байт 0 = размер заголовка 12/14, байты 8–11 = `.FIT`.
 * GPX — (UTF-8 BOM), пробелы, необязательная декларация `<?xml …?>`, комментарии и PI, затем корень `<gpx`
 * в первых 4 КБ. Декларация не обязательна: XML 1.0 её допускает, часть экспортёров её не пишет.
 * `<!DOCTYPE` перед корнем — не GPX (`null`): такие файлы всё равно отвергает `parseGpx`.
 */
export function detectTrackFormat(bytes: Uint8Array): Exclude<TrackFormat, 'stream'> | null {
  if (isFitHeader(bytes)) return 'fit';
  if (xmlRootAfterProlog(bytes, 'gpx')) return 'gpx';
  return null;
}

/**
 * Формат маршрута по содержимому (не по расширению): KMZ — сигнатура zip `PK\x03\x04` (любой zip; что внутри,
 * проверяет разбор worker'а); GPX, KML, TCX — тот же сканер пролога, корень `<gpx`, `<kml` или
 * `<TrainingCenterDatabase` в первых 4 КБ. `<!DOCTYPE` перед корнем, FIT-курс и прочее — `null`.
 */
export function detectRouteFormat(bytes: Uint8Array): RouteFileFormat | null {
  if (isZipHeader(bytes)) return 'kmz';
  if (xmlRootAfterProlog(bytes, 'gpx')) return 'gpx';
  if (xmlRootAfterProlog(bytes, 'kml')) return 'kml';
  if (xmlRootAfterProlog(bytes, 'TrainingCenterDatabase')) return 'tcx';
  return null;
}

/** Локальный заголовок записи zip: `50 4B 03 04`. */
function isZipHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isFitHeader(bytes: Uint8Array): boolean {
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  if (bytes.length < headerSize) return false;
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

/** После BOM, пробелов, `<?…?>` и комментариев — корень `<name` (за ним пробел, `>` или `/`). */
function xmlRootAfterProlog(bytes: Uint8Array, name: string): boolean {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const end = Math.min(bytes.length, XML_SNIFF_BYTES);
  // только ASCII-префикс: всё до корня — разметка; не-ASCII байты дают символы, которых нет в шаблонах ниже
  let head = '';
  for (let i = start; i < end; i += 1) head += String.fromCharCode(bytes[i]!);

  let pos = 0;
  for (;;) {
    while (pos < head.length && isXmlSpace(head.charCodeAt(pos))) pos += 1;
    if (head.startsWith('<?', pos)) {
      const close = head.indexOf('?>', pos + 2);
      if (close < 0) return false;
      pos = close + 2;
    } else if (head.startsWith('<!--', pos)) {
      const close = head.indexOf('-->', pos + 4);
      if (close < 0) return false;
      pos = close + 3;
    } else {
      break;
    }
  }
  if (!head.startsWith(`<${name}`, pos)) return false;
  const next = head.charCodeAt(pos + 1 + name.length);
  return isXmlSpace(next) || next === 0x3e || next === 0x2f; // пробел, '>' или '/'
}

function isXmlSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
