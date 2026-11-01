import type { PhotoScrimProfile, StoryCardColors } from '@pokatim/design-tokens';
import sharp from 'sharp';

import { MEDIA_POLICY } from '../media';

import { renderCardPng } from './story-card.png';

/**
 * Общая композиция карточек с фото организатора (ride-photo 4a, ride-photo-followups OG райда): фото `cover` по центру
 * → скрим → текстовый слой (прозрачный фон, цвета `onPhoto`) → PNG с палитрой. Чистые функции; worker и превью.
 * Настройки sharp процесса — `media/image-pipeline.ts`.
 */

export interface CardSize {
  width: number;
  height: number;
}

/**
 * Цвета карточки поверх фото: фон прозрачный (под ним — фото и скрим), текст, линии и плитка — роль `text.onPhoto`
 * (контраст к скриму — тест токенов `photoScrim`/`photoScrimHero`).
 */
export const onPhotoColors = (colors: StoryCardColors, onPhoto: string): StoryCardColors => ({
  ...colors,
  background: 'transparent',
  ink: onPhoto,
  muted: onPhoto,
  accent: onPhoto,
  rule: onPhoto,
  track: onPhoto,
});

/** Слой скрима размера кадра: вертикальный градиент `overlay.scrim` по остановкам профиля. */
export function scrimSvg(color: string, size: CardSize, profile: PhotoScrimProfile): string {
  const { width, height } = size;
  const stops = profile.stops
    .map((stop) => `<stop offset="${stop.at}" stop-color="${color}" stop-opacity="${stop.alpha}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#s)"/></svg>`
  );
}

/** Промежуточный слой — без предела финального PNG (предел проверяется у итога). */
export const layerPng = (svg: string, width: number) =>
  renderCardPng(svg, { width, maxBytes: Number.MAX_SAFE_INTEGER });

/**
 * Палитры кодирования карточки с фото: обычная и одна попытка меньше, если PNG не влез в предел (ревью ride-photo PR A,
 * LOW). Вторая — 16 цветов: libvips пишет палитру глубиной `ceil(log2(colours))` с округлением до 1/2/4/8 бит, поэтому
 * 128 цветов дают тот же 8-битный PNG и размер не меняют (замер sharp 0.35.5); 16 — 4 бита на пиксель, ≈ вдвое меньше.
 */
export const PHOTO_CARD_PALETTES = [256, 16] as const;

/**
 * Кадр (RGBA) → PNG с палитрой и дизерингом: палитры по очереди (`PHOTO_CARD_PALETTES`), первый результат в пределе
 * `maxBytes`; ни один не влез — ошибка (ретрай задачи, затем `failed`).
 */
export async function encodePhotoCard(
  frame: { data: Buffer; info: { width: number; height: number; channels: 1 | 2 | 3 | 4 } },
  maxBytes: number,
): Promise<Buffer> {
  let size = 0;
  for (const colours of PHOTO_CARD_PALETTES) {
    const png = await sharp(frame.data, { raw: frame.info })
      .png({ palette: true, colours, quality: 80, effort: 7, dither: 1 })
      .timeout({ seconds: MEDIA_POLICY.timeoutSec })
      .toBuffer();
    if (png.byteLength <= maxBytes) return png;
    size = png.byteLength;
  }
  throw new Error(`card png too large: ${size} bytes`);
}

export interface PhotoCardOptions {
  size: CardSize;
  scrimColor: string;
  profile: PhotoScrimProfile;
  maxBytes: number;
}

/**
 * Карточка с фото: фото — `cover` по центру в размер кадра → скрим профиля → текстовый слой (satori → resvg RGBA) →
 * PNG с палитрой и дизерингом (`encodePhotoCard`: фотографический truecolor PNG превысил бы предел). Байты фото не
 * идут через SVG/base64.
 */
export async function composeWithPhoto(
  photo: Uint8Array,
  textSvg: string,
  { size, scrimColor, profile, maxBytes }: PhotoCardOptions,
): Promise<Buffer> {
  const { data, info } = await sharp(photo, { failOn: 'error' })
    .resize(size.width, size.height, { fit: 'cover', position: 'centre' })
    .composite([
      { input: layerPng(scrimSvg(scrimColor, size, profile), size.width) },
      { input: layerPng(textSvg, size.width) },
    ])
    .raw()
    .timeout({ seconds: MEDIA_POLICY.timeoutSec })
    .toBuffer({ resolveWithObject: true });
  return encodePhotoCard(
    { data, info: { width: info.width, height: info.height, channels: info.channels } },
    maxBytes,
  );
}
