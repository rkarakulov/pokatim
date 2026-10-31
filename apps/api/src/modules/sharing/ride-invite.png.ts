import type { LonLat } from '@pokatim/contracts';
import {
  appThemes,
  DEFAULT_THEME,
  photoScrim,
  storyCard,
  type StoryCardColors,
  storyCardColors,
} from '@pokatim/design-tokens';
import sharp from 'sharp';

import { MEDIA_POLICY } from '../media';

import type { RideInviteInput } from './ride-invite.inputs';
import { type RideInviteRenderInput, rideInviteTree } from './ride-invite.render';
import { rideInviteTexts } from './ride-invite.texts';
import { type StoryCardFont, storyCardFonts } from './story-card.fonts';
import { STORY_CARD_POLICY } from './sharing.policy';
import { renderCardPng, renderCardSvg, renderStoryCardPng, storyCardTrack } from './story-card.png';
import { cardTrackView } from './story-card.render';

/**
 * Цвета 4a с фото (ride-photo, ADR-0028): фон страницы прозрачный (под ним — фото и скрим), текст, линии и плитка — роль
 * `text.onPhoto` (контраст к скриму — тест токена `photoScrim`); точка старта — акцент темы.
 */
const onPhotoColors = (colors: StoryCardColors, onPhoto: string): StoryCardColors => ({
  ...colors,
  background: 'transparent',
  ink: onPhoto,
  muted: onPhoto,
  accent: onPhoto,
  rule: onPhoto,
  track: onPhoto,
});

/**
 * Входы рендера приглашения: тема (незнакомая — по умолчанию), схема по шаблону (`line` — светлая, `night` —
 * тёмная), тексты, линия публичного маршрута. Фото рисует только `night` (4a).
 */
export function rideInviteRenderInput(
  input: RideInviteInput,
  line: readonly LonLat[] | null,
  { photo = false }: { photo?: boolean } = {},
): RideInviteRenderInput {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const scheme = input.template === 'line' ? theme.schemes.light : theme.schemes.dark;
  const colors = storyCardColors(scheme);
  return {
    template: input.template,
    colors:
      photo && input.template === 'night' ? onPhotoColors(colors, scheme.text.onPhoto) : colors,
    texts: rideInviteTexts(input),
    track: line ? storyCardTrack(line, cardTrackView(input.template)) : null,
  };
}

export function renderRideInviteSvg(
  input: RideInviteRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(rideInviteTree(input), fonts);
}

/** Слой скрима 1080×1920: вертикальный градиент `overlay.scrim` по остановкам токена `photoScrim`. */
function scrimSvg(color: string): string {
  const { width, height } = storyCard.size;
  const stops = photoScrim.stops
    .map((stop) => `<stop offset="${stop.at}" stop-color="${color}" stop-opacity="${stop.alpha}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#s)"/></svg>`
  );
}

/** Промежуточный слой — без предела финального PNG (предел проверяется у итога). */
const layerPng = (svg: string) =>
  renderCardPng(svg, { width: storyCard.size.width, maxBytes: Number.MAX_SAFE_INTEGER });

/**
 * 4a с фото: фото — `cover` по центру в 1080×1920 → скрим → текстовый слой (тот же `nightCard`, прозрачный фон;
 * satori → resvg RGBA) → PNG с палитрой и дизерингом (фотографический truecolor PNG 1080×1920 превысил бы
 * `maxPngBytes`, R5). Байты фото не идут через SVG/base64. Настройки sharp процесса — `media/image-pipeline.ts`.
 */
async function composeWithPhoto(
  photo: Uint8Array,
  textSvg: string,
  scrimColor: string,
): Promise<Buffer> {
  const { width, height } = storyCard.size;
  const png = await sharp(photo, { failOn: 'error' })
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .composite([{ input: layerPng(scrimSvg(scrimColor)) }, { input: layerPng(textSvg) }])
    .png({ palette: true, quality: 80, effort: 7, dither: 1 })
    .timeout({ seconds: MEDIA_POLICY.timeoutSec })
    .toBuffer();
  if (png.byteLength > STORY_CARD_POLICY.maxPngBytes) {
    throw new Error(`card png too large: ${png.byteLength} bytes`);
  }
  return png;
}

/**
 * Карточка-приглашение целиком: шрифты темы → SVG → PNG (тот же предел размера, что у сторис). `photo` — байты фото
 * организатора (ride-photo): рисуются только у `night` (4a), у `line` не используются.
 */
export async function renderRideInvite(
  input: RideInviteInput,
  line: readonly LonLat[] | null,
  photo: Uint8Array | null = null,
): Promise<Buffer> {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const withPhoto = photo !== null && input.template === 'night';
  const svg = await renderRideInviteSvg(
    rideInviteRenderInput(input, line, { photo: withPhoto }),
    await storyCardFonts(theme),
  );
  if (!withPhoto) return renderStoryCardPng(svg);
  return composeWithPhoto(photo, svg, theme.schemes.dark.overlay.scrim);
}
