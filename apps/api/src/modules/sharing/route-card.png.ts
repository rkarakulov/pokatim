import type { LonLat } from '@pokatim/contracts';
import { appThemes, DEFAULT_THEME, storyCardColors } from '@pokatim/design-tokens';

import type { RouteCardInput } from './route-card.inputs';
import { type RouteCardRenderInput, routeCardTree } from './route-card.render';
import { routeCardTexts } from './route-card.texts';
import { type StoryCardFont, storyCardFonts } from './story-card.fonts';
import { renderCardSvg, renderStoryCardPng, storyCardTrack } from './story-card.png';
import { cardTrackView } from './story-card.render';

/**
 * Входы рендера карточки маршрута: тема (незнакомая — по умолчанию), схема по шаблону (`line` — светлая, `night` —
 * тёмная), тексты, линия показа маршрута каталога.
 */
export function routeCardRenderInput(
  input: RouteCardInput,
  line: readonly LonLat[],
): RouteCardRenderInput {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const scheme = input.template === 'line' ? theme.schemes.light : theme.schemes.dark;
  return {
    template: input.template,
    colors: storyCardColors(scheme),
    texts: routeCardTexts(input),
    track: storyCardTrack(line, cardTrackView(input.template)),
  };
}

export function renderRouteCardSvg(
  input: RouteCardRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(routeCardTree(input), fonts);
}

/** Карточка маршрута целиком: шрифты темы → SVG → PNG (тот же предел размера, что у сторис). */
export async function renderRouteCard(
  input: RouteCardInput,
  line: readonly LonLat[],
): Promise<Buffer> {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const svg = await renderRouteCardSvg(
    routeCardRenderInput(input, line),
    await storyCardFonts(theme),
  );
  return renderStoryCardPng(svg);
}
