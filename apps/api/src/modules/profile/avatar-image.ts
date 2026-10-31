import { AVATAR_MIN_CROP_PX, AVATAR_SIZE_PX } from '@pokatim/contracts';
import sharp from 'sharp';

import { decodeOriented, type ImageFormat, inspectImage, MEDIA_POLICY } from '../media';

/**
 * Обработка аватара (rider-profile, ADR-0019) поверх общего конвейера `media` (ADR-0028): ограниченное
 * перекодирование в HTTP-обработчике (RC-A1) — вход до 10 МиБ, JPEG/WebP до 100 Мп с shrink-on-load, PNG до 25 Мп,
 * таймаут 10 с, одна обработка на процесс (`ImageProcessing`); настройки sharp — только в `media/image-pipeline.ts`.
 * Вывод — только JPEG 512×512 без метаданных.
 */

/** Формат по сигнатуре — старое имя для импортов профиля (реализация — `media`). */
export { detectImageFormat } from '../media';

export type AvatarFormat = ImageFormat;

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
 * памяти libvips не растёт с мегапикселями входа (замер — ADR-0019). Обрезка 512 px из кадра 2048 px: квадрат от
 * трети короткой стороны — без увеличения.
 */
export const AVATAR_DECODE_EDGE_PX = 2048;

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
  const inspected = await inspectImage(bytes);
  // `too_small` у заголовка не бывает; отказ аватара — только `unsupported` | `invalid`
  if (!inspected.ok) {
    return {
      ok: false,
      error: inspected.error === 'unsupported' ? 'unsupported' : 'invalid',
      format: inspected.format,
    };
  }
  const { format, oriented } = inspected;
  const rect = cropRect(oriented.width, oriented.height, crop);
  if (!rect) return { ok: false, error: 'invalid', format };
  try {
    const { data, info } = await decodeOriented(bytes, format, AVATAR_DECODE_EDGE_PX);
    const output = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .extract(scaleRect(rect, oriented, info))
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX)
      .jpeg({ quality: MEDIA_POLICY.jpegQuality })
      .timeout({ seconds: MEDIA_POLICY.timeoutSec })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(output), format };
  } catch {
    return { ok: false, error: 'invalid', format };
  }
}
