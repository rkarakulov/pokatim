import { AVATAR_MAX_INPUT_PIXELS, AVATAR_MAX_PNG_PIXELS } from '@pokatim/contracts';

/** Форматы входа (белый список): только они проходят сигнатуру и сверку с декодером. */
export type ImageFormat = 'jpeg' | 'png' | 'webp';

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Формат по сигнатуре: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`; иначе `null`. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/**
 * Предел пикселей входа по формату (ADR-0019): JPEG и WebP — 100 Мп (декод с уменьшением при загрузке), у PNG
 * shrink-on-load нет — 25 Мп. Значения — общие с аватаром (контракт `AVATAR_MAX_*`).
 */
export const maxPixels = (format: ImageFormat): number =>
  format === 'png' ? AVATAR_MAX_PNG_PIXELS : AVATAR_MAX_INPUT_PIXELS;
