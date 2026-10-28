import {
  AVATAR_MAX_INPUT_PIXELS,
  AVATAR_MAX_PNG_PIXELS,
  AVATAR_MIN_CROP_PX,
  AVATAR_SIZE_PX,
} from '@pokatim/contracts';
import sharp from 'sharp';

/**
 * Обработка аватара (rider-profile, ADR-0018): ограниченное перекодирование в HTTP-обработчике (RC-A1) — вход до
 * 10 МиБ, JPEG/WebP до 100 Мп с shrink-on-load, PNG до 25 Мп, таймаут 10 с, одна обработка на процесс;
 * декодирование — в пуле libvips, не в event loop. Вывод — только JPEG 512×512 без метаданных (EXIF, GPS, XMP и ICC не пишутся: `keepMetadata`/`withMetadata`/`withExif` не вызываются).
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
 * Длинная сторона промежуточного кадра: JPEG и WebP декодируются с уменьшением при загрузке (shrink-on-load) — пик
 * памяти libvips не растёт с мегапикселями входа (замер — ADR-0018). Обрезка 512 px из кадра 2048 px: квадрат от
 * трети короткой стороны — без увеличения.
 */
export const AVATAR_DECODE_EDGE_PX = 2048;

/** Предел пикселей по формату: у PNG shrink-on-load нет. */
const maxPixels = (format: AvatarFormat) =>
  format === 'png' ? AVATAR_MAX_PNG_PIXELS : AVATAR_MAX_INPUT_PIXELS;

/**
 * Квадрат обрезки исходника → в координатах уменьшенного кадра (чистая): масштаб — по ширине; сторона ≥ 1 и в рамках.
 */
export function scaleRect(
  rect: CropRect,
  from: { width: number; height: number },
  to: { width: number; height: number },
): CropRect {
  const scale = to.width / from.width;
  const side = Math.max(1, Math.min(to.width, to.height, Math.round(rect.width * scale)));
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    left: clamp(Math.round(rect.left * scale), to.width - side),
    top: clamp(Math.round(rect.top * scale), to.height - side),
    width: side,
    height: side,
  };
}

/**
 * Перекодирование аватара: сигнатура → заголовок (формат декодера = сигнатуре, размеры после ориентации, предел
 * пикселей по формату) → квадрат в координатах ориентированного исходника (сторона ≥ 64 px) → стадия 1: поворот по
 * EXIF и уменьшение до 2048 px по длинной стороне (`fit: inside`, без увеличения; JPEG/WebP — shrink-on-load) в raw →
 * стадия 2: квадрат в пересчитанных координатах, 512×512 JPEG без метаданных. Не тот формат — `unsupported`; не
 * декодируется, больше предела, мелкая обрезка, таймаут — `invalid` (сообщение libvips наружу и в логи не уходит).
 */
export async function processAvatar(
  bytes: Uint8Array,
  crop: CropIntent | null,
): Promise<AvatarResult> {
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, error: 'unsupported' };
  const limit = maxPixels(format);
  const input = () =>
    sharp(bytes, {
      limitInputPixels: limit,
      failOn: 'error',
      animated: false,
      sequentialRead: true,
    });
  let oriented: { width: number; height: number };
  try {
    const meta = await input().metadata();
    if (meta.format !== format) return { ok: false, error: 'unsupported', format };
    if (meta.width * meta.height > limit) return { ok: false, error: 'invalid', format };
    oriented = meta.autoOrient;
  } catch {
    return { ok: false, error: 'invalid', format };
  }
  const rect = cropRect(oriented.width, oriented.height, crop);
  if (!rect) return { ok: false, error: 'invalid', format };
  try {
    const { data, info } = await input()
      .autoOrient()
      .resize({
        width: AVATAR_DECODE_EDGE_PX,
        height: AVATAR_DECODE_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .raw()
      .timeout({ seconds: AVATAR_TIMEOUT_SEC })
      .toBuffer({ resolveWithObject: true });
    const output = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .extract(scaleRect(rect, oriented, info))
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX)
      .jpeg({ quality: AVATAR_JPEG_QUALITY })
      .timeout({ seconds: AVATAR_TIMEOUT_SEC })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(output), format };
  } catch {
    return { ok: false, error: 'invalid', format };
  }
}
