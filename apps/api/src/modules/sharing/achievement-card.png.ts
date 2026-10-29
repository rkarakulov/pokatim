import {
  appThemes,
  DEFAULT_THEME,
  storyCardBadgeColors,
  storyCardColors,
} from '@pokatim/design-tokens';

import { ACHIEVEMENT_BADGE_ICONS } from './achievement-card.icons';
import type { AchievementCardInput } from './achievement-card.inputs';
import { type AchievementCardRenderInput, achievementCardTree } from './achievement-card.render';
import { achievementCardTexts } from './achievement-card.texts';
import { type StoryCardFont, storyCardFonts, symbolsFont } from './story-card.fonts';
import { renderCardSvg, renderStoryCardPng } from './story-card.png';

/** Входы рендера: тема (незнакомая — по умолчанию), схема по шаблону (`line` — светлая, `night` — тёмная), тексты, значок. */
export function achievementCardRenderInput(
  input: AchievementCardInput,
): AchievementCardRenderInput {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const scheme = input.template === 'line' ? theme.schemes.light : theme.schemes.dark;
  return {
    template: input.template,
    colors: storyCardColors(scheme),
    badgeColors: storyCardBadgeColors(scheme),
    icon: ACHIEVEMENT_BADGE_ICONS[input.facts.code],
    texts: achievementCardTexts(input),
  };
}

export function renderAchievementCardSvg(
  input: AchievementCardRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(achievementCardTree(input), fonts);
}

/** Шрифты темы и иконок → SVG → PNG 1080×1920 (тот же предел размера, что у сторис). */
export async function renderAchievementCard(input: AchievementCardInput): Promise<Buffer> {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const [fonts, symbols] = await Promise.all([storyCardFonts(theme), symbolsFont()]);
  const svg = await renderAchievementCardSvg(achievementCardRenderInput(input), [
    ...fonts,
    symbols,
  ]);
  return renderStoryCardPng(svg);
}
