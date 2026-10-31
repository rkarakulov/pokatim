import type { LonLat } from '@pokatim/contracts';
import { appThemes, DEFAULT_THEME, storyCard, storyCardColors } from '@pokatim/design-tokens';
import { contourPath } from '@pokatim/route-view';
import { boundsOf, simplifyTrack } from '@pokatim/tracks';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { STORY_CARD_POLICY } from './sharing.policy';
import { type StoryCardFont, storyCardFonts } from './story-card.fonts';
import type { StoryCardInput } from './story-card.inputs';
import {
  type StoryCardNode,
  type StoryCardRenderInput,
  type StoryCardTrack,
  storyCardTrackView,
  storyCardTree,
} from './story-card.render';
import { storyCardTexts } from './story-card.texts';

/**
 * Линия → координаты яруса (`view` — `storyCardTrackView` шаблона или плитка приглашения; `contourPath`: локальная
 * проекция, север вверху); > лимита точек — упрощение.
 */
export function storyCardTrack(
  line: readonly LonLat[],
  view: { width: number; height: number; padding: number },
): StoryCardTrack | null {
  const points =
    line.length > storyCard.trackMaxPoints
      ? simplifyTrack(
          line.map(([lon, lat]) => ({ lon, lat })),
          1,
          storyCard.trackMaxPoints,
        ).map(({ lon, lat }) => [lon, lat] as LonLat)
      : [...line];
  const bounds = boundsOf(points);
  if (!bounds || points.length < 2) return null;
  const contour = contourPath(points, bounds, view);
  return contour
    ? {
        view: { width: view.width, height: view.height },
        points: contour.points,
        start: contour.start,
      }
    : null;
}

/**
 * Входы рендера: тема (незнакомая — тема по умолчанию), схема по шаблону (`line` — светлая, `night` — тёмная; у тем
 * «всегда тёмная» схемы совпадают), тексты, трек.
 */
export function storyCardRenderInput(
  input: StoryCardInput,
  line: readonly LonLat[] | null,
): StoryCardRenderInput {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const scheme = input.template === 'line' ? theme.schemes.light : theme.schemes.dark;
  return {
    template: input.template,
    colors: storyCardColors(scheme),
    texts: storyCardTexts(input),
    track: line ? storyCardTrack(line, storyCardTrackView(input.template)) : null,
    address: input.address,
  };
}

/** Карточка целиком: шрифты темы → SVG → PNG. */
export async function renderStoryCard(
  input: StoryCardInput,
  line: readonly LonLat[] | null,
): Promise<Buffer> {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const svg = await renderStoryCardSvg(
    storyCardRenderInput(input, line),
    await storyCardFonts(theme),
  );
  return renderStoryCardPng(svg);
}

/** Дерево карточки → SVG (satori: вёрстка текста шрифтами темы, текст — в путях). */
export function renderStoryCardSvg(
  input: StoryCardRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(storyCardTree(input), fonts);
}

/** Любое дерево карточки → SVG размера `size` (по умолчанию 1080×1920: сторис гонки, приглашение райда; OG — 1200×630). */
export function renderCardSvg(
  tree: StoryCardNode,
  fonts: StoryCardFont[],
  size: { width: number; height: number } = storyCard.size,
): Promise<string> {
  // satori принимает React-подобные узлы `{ type, props }`; React в API не нужен — приведение в одном месте
  const element = tree as unknown as Parameters<typeof satori>[0];
  return satori(element, { width: size.width, height: size.height, fonts });
}

/** SVG → PNG шириной `width` (resvg, без системных шрифтов: текст satori уже в путях); больше `maxBytes` — ошибка. */
export function renderCardPng(
  svg: string,
  { width, maxBytes }: { width: number; maxBytes: number },
): Buffer {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  if (png.byteLength > maxBytes) {
    throw new Error(`card png too large: ${png.byteLength} bytes`);
  }
  return png;
}

/** SVG → PNG 1080×1920 карточки для сторис и приглашения (предел — `STORY_CARD_POLICY.maxPngBytes`). */
export function renderStoryCardPng(svg: string): Buffer {
  return renderCardPng(svg, {
    width: storyCard.size.width,
    maxBytes: STORY_CARD_POLICY.maxPngBytes,
  });
}
