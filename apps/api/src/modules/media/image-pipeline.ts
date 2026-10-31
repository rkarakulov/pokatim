import sharp from 'sharp';

import { detectImageFormat, type ImageFormat, maxPixels } from './image-format';
import { MEDIA_POLICY } from './media.policy';

/**
 * Конвейер изображений (ADR-0019, ADR-0028) — единственное место настроек sharp процесса: кэш операций выключен
 * (байты чужих фото не держатся в памяти), один поток libvips на операцию. Декод — в пуле libvips, не в event loop;
 * `failOn: 'error'`, без анимации, последовательное чтение, предел пикселей по формату, таймаут. Выход — только JPEG
 * без метаданных (EXIF, GPS, XMP и ICC не пишутся: `keepMetadata`/`withMetadata`/`withExif` не вызываются).
 * Сообщения libvips наружу и в логи не уходят — только код отказа.
 */
sharp.cache(false);
sharp.concurrency(1);

/** Отказ: не тот формат — `unsupported`; не декодируется, больше предела, таймаут — `invalid`; мелкое — `too_small`. */
export interface ImageFailure {
  ok: false;
  error: 'unsupported' | 'invalid' | 'too_small';
  format?: ImageFormat;
}

export type ImageInspection =
  { ok: true; format: ImageFormat; oriented: { width: number; height: number } } | ImageFailure;

export type ImageResult =
  | { ok: true; bytes: Uint8Array; format: ImageFormat; width: number; height: number }
  | ImageFailure;

const input = (bytes: Uint8Array, format: ImageFormat) =>
  sharp(bytes, {
    limitInputPixels: maxPixels(format),
    failOn: 'error',
    animated: false,
    sequentialRead: true,
  });

/**
 * Сигнатура → заголовок: формат декодера совпадает с сигнатурой, пикселей не больше предела формата; размеры — после
 * поворота по EXIF.
 */
export async function inspectImage(bytes: Uint8Array): Promise<ImageInspection> {
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, error: 'unsupported' };
  try {
    const meta = await input(bytes, format).metadata();
    if (meta.format !== format) return { ok: false, error: 'unsupported', format };
    if (meta.width * meta.height > maxPixels(format))
      return { ok: false, error: 'invalid', format };
    return { ok: true, format, oriented: meta.autoOrient };
  } catch {
    return { ok: false, error: 'invalid', format };
  }
}

/**
 * Стадия декода: поворот по EXIF и уменьшение до `edgePx` по длинной стороне (`fit: inside`, без увеличения;
 * JPEG/WebP — shrink-on-load) в raw. Ошибка libvips пробрасывается — вызывающий сводит её к `invalid`.
 */
export function decodeOriented(bytes: Uint8Array, format: ImageFormat, edgePx: number) {
  return input(bytes, format)
    .autoOrient()
    .resize({ width: edgePx, height: edgePx, fit: 'inside', withoutEnlargement: true })
    .raw()
    .timeout({ seconds: MEDIA_POLICY.timeoutSec })
    .toBuffer({ resolveWithObject: true });
}

/**
 * Обложка (фото райда): заголовок → одна стадия «поворот по EXIF + вписать в `maxEdgePx` (без увеличения) → JPEG».
 * Короткая сторона **результата** меньше `minShortPx` — `too_small` (панорама 12000×600 после вписывания — полоса
 * 1600×80, ADR-0028).
 */
export async function processCover(
  bytes: Uint8Array,
  { maxEdgePx, minShortPx }: { maxEdgePx: number; minShortPx: number },
): Promise<ImageResult> {
  const inspected = await inspectImage(bytes);
  if (!inspected.ok) return inspected;
  const { format } = inspected;
  try {
    const { data, info } = await input(bytes, format)
      .autoOrient()
      .resize({ width: maxEdgePx, height: maxEdgePx, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: MEDIA_POLICY.jpegQuality })
      .timeout({ seconds: MEDIA_POLICY.timeoutSec })
      .toBuffer({ resolveWithObject: true });
    if (Math.min(info.width, info.height) < minShortPx) {
      return { ok: false, error: 'too_small', format };
    }
    return {
      ok: true,
      bytes: new Uint8Array(data),
      format,
      width: info.width,
      height: info.height,
    };
  } catch {
    return { ok: false, error: 'invalid', format };
  }
}
