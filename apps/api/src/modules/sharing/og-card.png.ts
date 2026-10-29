import type { LonLat } from '@pokatim/contracts';
import { appThemes, DEFAULT_THEME, ogCard, storyCardColors } from '@pokatim/design-tokens';

import type { OgCardInput } from './og-card.inputs';
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

/** Входы рендера объекта: светлая схема темы (незнакомая — по умолчанию), тексты, линия в плитке. */
export function ogCardRenderInput(
  input: Exclude<OgCardInput, { kind: 'brand' }>,
  line: readonly LonLat[] | null,
): OgCardRenderInput {
  return {
    colors: storyCardColors(themeOf(input).schemes.light),
    texts: ogCardTexts(input),
    track: line ? storyCardTrack(line, ogTileView()) : null,
  };
}

export function ogBrandRenderInput(input: OgCardInput): OgBrandRenderInput {
  return { colors: storyCardColors(themeOf(input).schemes.light), texts: ogBrandTexts() };
}

/** Дерево картинки по виду (бренд — без линии). */
export function ogTree(input: OgCardInput, line: readonly LonLat[] | null): StoryCardNode {
  return input.kind === 'brand'
    ? ogBrandTree(ogBrandRenderInput(input))
    : ogCardTree(ogCardRenderInput(input, line));
}

/** OG-картинка целиком (только worker и превью): шрифты темы → SVG 1200×630 → PNG ≤ `maxPngBytes`. */
export async function renderOgCard(
  input: OgCardInput,
  line: readonly LonLat[] | null,
): Promise<Buffer> {
  const svg = await renderCardSvg(
    ogTree(input, line),
    await storyCardFonts(themeOf(input)),
    ogCard.size,
  );
  return renderCardPng(svg, { width: ogCard.size.width, maxBytes: OG_CARD_POLICY.maxPngBytes });
}
