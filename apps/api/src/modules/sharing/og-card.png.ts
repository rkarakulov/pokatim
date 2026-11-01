import type { LonLat } from '@pokatim/contracts';
import {
  appThemes,
  DEFAULT_THEME,
  ogCard,
  photoScrimHero,
  storyCardColors,
} from '@pokatim/design-tokens';

import type { OgCardInput } from './og-card.inputs';
import { composeWithPhoto, onPhotoColors } from './photo-card.png';
import {
  type OgBrandRenderInput,
  ogBrandTree,
  type OgCardRenderInput,
  ogCardTree,
  ogTileView,
} from './og-card.render';
import { ogBrandTexts, ogCardTexts } from './og-card.texts';
import { OG_CARD_POLICY } from './sharing.policy';
import { storyCardFonts } from './story-card.fonts';
import { type StoryCardNode } from './story-card.render';
import { renderCardPng, renderCardSvg, storyCardTrack } from './story-card.png';

const themeOf = (input: OgCardInput) => appThemes[input.themeId] ?? DEFAULT_THEME;
/** Цвета схемы входа (`OG_CARD_POLICY.scheme` вида: `light` — «Линия», `dark` — «Ночь»). */
const colorsOf = (input: OgCardInput) => storyCardColors(themeOf(input).schemes[input.scheme]);

/**
 * Входы рендера объекта: схема вида темы (незнакомая тема — по умолчанию), тексты, линия в плитке. `photo` — картинка
 * поверх фото организатора райда (ride-photo-followups): фон прозрачный, текст и плитка — `onPhoto` схемы вида.
 */
export function ogCardRenderInput(
  input: Exclude<OgCardInput, { kind: 'brand' }>,
  line: readonly LonLat[] | null,
  { photo = false }: { photo?: boolean } = {},
): OgCardRenderInput {
  const colors = colorsOf(input);
  return {
    colors: photo
      ? onPhotoColors(colors, themeOf(input).schemes[input.scheme].text.onPhoto)
      : colors,
    texts: ogCardTexts(input),
    track: line ? storyCardTrack(line, ogTileView()) : null,
  };
}

export function ogBrandRenderInput(input: OgCardInput): OgBrandRenderInput {
  return { colors: colorsOf(input), texts: ogBrandTexts() };
}

/** Дерево картинки по виду (бренд — без линии); `photo` — поверх фото райда. */
export function ogTree(
  input: OgCardInput,
  line: readonly LonLat[] | null,
  { photo = false }: { photo?: boolean } = {},
): StoryCardNode {
  return input.kind === 'brand'
    ? ogBrandTree(ogBrandRenderInput(input))
    : ogCardTree(ogCardRenderInput(input, line, { photo }));
}

/**
 * OG-картинка целиком (только worker и превью): шрифты темы → SVG 1200×630 → PNG ≤ `maxPngBytes`. `photo` — байты фото
 * организатора райда (ride-photo-followups): фото `cover` → скрим `overlay.scrim` схемы вида с профилем `photoScrimHero`
 * → тот же макет с цветами `onPhoto` → PNG с палитрой ≤ `maxPhotoPngBytes`. Другие виды фото не рисуют.
 */
export async function renderOgCard(
  input: OgCardInput,
  line: readonly LonLat[] | null,
  photo: Uint8Array | null = null,
): Promise<Buffer> {
  const withPhoto = photo !== null && input.kind === 'ride';
  const svg = await renderCardSvg(
    ogTree(input, line, { photo: withPhoto }),
    await storyCardFonts(themeOf(input)),
    ogCard.size,
  );
  if (!withPhoto) {
    return renderCardPng(svg, { width: ogCard.size.width, maxBytes: OG_CARD_POLICY.maxPngBytes });
  }
  return composeWithPhoto(photo, svg, {
    size: ogCard.size,
    scrimColor: themeOf(input).schemes[input.scheme].overlay.scrim,
    profile: photoScrimHero,
    maxBytes: OG_CARD_POLICY.maxPhotoPngBytes,
  });
}
