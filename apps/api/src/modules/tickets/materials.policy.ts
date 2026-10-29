import {
  EVENT_MATERIAL_FILE_MAX_BYTES,
  EVENT_MATERIAL_FILE_NAME_MAX,
  EVENT_MATERIAL_FILES_MAX,
  EVENT_MATERIALS_MAX,
} from '@pokatim/contracts';

import { DEFAULT_BODY_TIMEOUTS } from '../../raw-body';

/** Пределы материалов событий (event-tickets PR C). */
export const MATERIALS_POLICY = {
  itemsMax: EVENT_MATERIALS_MAX,
  filesMax: EVENT_MATERIAL_FILES_MAX,
  fileMaxBytes: EVENT_MATERIAL_FILE_MAX_BYTES,
  fileNameMax: EVENT_MATERIAL_FILE_NAME_MAX,
  bodyTimeouts: DEFAULT_BODY_TIMEOUTS,
  /** загрузки PDF сотрудника — до тела */
  uploadLimit: { limit: 30, windowSec: 3600 },
  /** отдача PDF — на IP, сверх `public-read` */
  fileIpLimit: { limit: 60, windowSec: 3600 },
  /** имя без пригодных символов */
  fallbackName: 'material.pdf',
} as const;

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

/** PDF по содержимому: сигнатура `%PDF-` с нулевого смещения (не по имени и не по заголовку). */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PDF_SIGNATURE.byteLength &&
    Buffer.from(bytes.buffer, bytes.byteOffset, PDF_SIGNATURE.byteLength).equals(PDF_SIGNATURE)
  );
}

/**
 * Имя файла для показа и скачивания: без управляющих символов, `/`, `\`, `"` (→ `_`), обрезка до предела с
 * расширением `.pdf`; пусто — `material.pdf`.
 */
export function safeFileName(input: string): string {
  const cleaned = input
    .replace(/\p{Cc}/gu, '')
    .replace(/[/\\"]/g, '_')
    .trim();
  if (cleaned === '') return MATERIALS_POLICY.fallbackName;
  const named = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
  if (named.length <= MATERIALS_POLICY.fileNameMax) return named;
  const ext = named.slice(-4);
  return `${[...named.slice(0, -4)].slice(0, MATERIALS_POLICY.fileNameMax - 4).join('')}${ext}`;
}

/** RFC 5987 `attr-char`: `encodeURIComponent` оставляет `'()*!` — кодируем и их. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `Content-Disposition` PDF (RC-C3): `attachment` — файл скачивается (inline + `sandbox` Chromium не показывает),
 * ASCII-заглушка + имя UTF-8 в `filename*`.
 */
export function contentDisposition(fileName: string): string {
  return `attachment; filename="${MATERIALS_POLICY.fallbackName}"; filename*=UTF-8''${encodeRfc5987(safeFileName(fileName))}`;
}
