import { AVATAR_MAX_INPUT_PIXELS, AVATAR_MIN_CROP_PX, AVATAR_SIZE_PX } from '@pokatim/contracts';
import sharp from 'sharp';

/**
 * Обработка аватара (rider-profile, ADR-0018): ограниченное перекодирование в HTTP-обработчике (RC-A1) — вход до
 * 10 МиБ и 40 Мп, таймаут 10 с, слоты приёма; декодирование — в пуле libvips, не в event loop. Вывод — только JPEG
 * 512×512 без метаданных (EXIF, GPS, XMP и ICC не пишутся: `keepMetadata`/`withMetadata`/`withExif` не вызываются).
 * Кэш операций sharp выключен (байты чужих фото не держатся в памяти), один поток libvips на операцию.
 */
sharp.cache(false);
sharp.concurrency(1);

export type AvatarFormat = 'jpeg' | 'png' | 'webp';

/** Квадрат обрезки в пикселях ориентированного изображения. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Намерение обрезки клиента — доли ориентированного изображения (`AvatarCropQuery`). */
export interface CropIntent {
  x: number;
  y: number;
  size: number;
}

export type AvatarResult =
  | { ok: true; bytes: Uint8Array; format: AvatarFormat }
  | { ok: false; error: 'unsupported' | 'invalid'; format?: AvatarFormat };

/** Таймаут конвейера sharp, с. */
export const AVATAR_TIMEOUT_SEC = 10;
/** Качество JPEG аватара. */
const AVATAR_JPEG_QUALITY = 82;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Формат по сигнатуре: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`; иначе `null`. */
export function detectImageFormat(bytes: Uint8Array): AvatarFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/**
 * Квадрат обрезки (чистая): без намерения — центральный квадрат меньшей стороны; иначе сторона `size · min(w, h)`,
 * угол `(x · w, y · h)`, сдвиг внутрь рамок. Сторона меньше `AVATAR_MIN_CROP_PX` — `null`.
 */
export function cropRect(width: number, height: number, crop: CropIntent | null): CropRect | null {
  const short = Math.min(width, height);
  const side = crop ? Math.min(short, Math.round(crop.size * short)) : short;
  if (side < AVATAR_MIN_CROP_PX) return null;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const left = crop
    ? clamp(Math.round(crop.x * width), width - side)
    : Math.floor((width - side) / 2);
  const top = crop
    ? clamp(Math.round(crop.y * height), height - side)
    : Math.floor((height - side) / 2);
  return { left, top, width: side, height: side };
}

/**
 * Перекодирование аватара: сигнатура → заголовок (формат декодера = сигнатуре, размеры после ориентации, предел
 * пикселей) → поворот по EXIF, квадрат, 512×512 JPEG. Не тот формат — `unsupported`; не декодируется, больше 40 Мп,
 * мелкая обрезка, таймаут — `invalid` (сообщение libvips наружу и в логи не уходит).
 */
export async function processAvatar(
  bytes: Uint8Array,
  crop: CropIntent | null,
): Promise<AvatarResult> {
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, error: 'unsupported' };
  const input = () =>
    sharp(bytes, {
      limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
      sequentialRead: true,
    });
  let width: number;
  let height: number;
  try {
    const meta = await input().metadata();
    if (meta.format !== format) return { ok: false, error: 'unsupported', format };
    if (meta.width * meta.height > AVATAR_MAX_INPUT_PIXELS) {
      return { ok: false, error: 'invalid', format };
    }
    ({ width, height } = meta.autoOrient);
  } catch {
    return { ok: false, error: 'invalid', format };
  }
  const rect = cropRect(width, height, crop);
  if (!rect) return { ok: false, error: 'invalid', format };
  try {
    const output = await input()
      .autoOrient()
      .extract(rect)
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX)
      .jpeg({ quality: AVATAR_JPEG_QUALITY })
      .timeout({ seconds: AVATAR_TIMEOUT_SEC })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(output), format };
  } catch {
    return { ok: false, error: 'invalid', format };
  }
}
