import type { TrackFormat } from './track.ts';

/** Сколько байт начала файла смотрим в поисках корня `<gpx`. */
const GPX_SNIFF_BYTES = 4096;

/**
 * Формат по содержимому (не по расширению).
 * FIT — байт 0 = размер заголовка 12/14, байты 8–11 = `.FIT`.
 * GPX — (UTF-8 BOM), пробелы, необязательная декларация `<?xml …?>`, комментарии и PI, затем корень `<gpx`
 * в первых 4 КБ. Декларация не обязательна: XML 1.0 её допускает, часть экспортёров её не пишет.
 * `<!DOCTYPE` перед корнем — не GPX (`null`): такие файлы всё равно отвергает `parseGpx`.
 */
export function detectTrackFormat(bytes: Uint8Array): Exclude<TrackFormat, 'stream'> | null {
  if (isFitHeader(bytes)) return 'fit';
  if (isGpxHead(bytes)) return 'gpx';
  return null;
}

function isFitHeader(bytes: Uint8Array): boolean {
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  if (bytes.length < headerSize) return false;
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

function isGpxHead(bytes: Uint8Array): boolean {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const end = Math.min(bytes.length, GPX_SNIFF_BYTES);
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
  if (!head.startsWith('<gpx', pos)) return false;
  const next = head.charCodeAt(pos + 4);
  return isXmlSpace(next) || next === 0x3e || next === 0x2f; // пробел, '>' или '/'
}

function isXmlSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
