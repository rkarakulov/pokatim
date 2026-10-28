import type { LonLat } from '@pokatim/contracts';
import { appThemes, DEFAULT_THEME, storyCardColors } from '@pokatim/design-tokens';

import type { RideInviteInput } from './ride-invite.inputs';
import {
  type RideInviteRenderInput,
  rideInviteTrackView,
  rideInviteTree,
} from './ride-invite.render';
import { rideInviteTexts } from './ride-invite.texts';
import { type StoryCardFont, storyCardFonts } from './story-card.fonts';
import { renderCardSvg, renderStoryCardPng, storyCardTrack } from './story-card.png';

/**
 * Входы рендера приглашения: тема (незнакомая — по умолчанию), схема по шаблону (`line` — светлая, `night` —
 * тёмная), тексты, линия публичного маршрута.
 */
export function rideInviteRenderInput(
  input: RideInviteInput,
  line: readonly LonLat[] | null,
): RideInviteRenderInput {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const scheme = input.template === 'line' ? theme.schemes.light : theme.schemes.dark;
  return {
    template: input.template,
    colors: storyCardColors(scheme),
    texts: rideInviteTexts(input),
    track: line ? storyCardTrack(line, rideInviteTrackView(input.template)) : null,
  };
}

export function renderRideInviteSvg(
  input: RideInviteRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(rideInviteTree(input), fonts);
}

/** Карточка-приглашение целиком: шрифты темы → SVG → PNG (тот же предел размера, что у сторис). */
export async function renderRideInvite(
  input: RideInviteInput,
  line: readonly LonLat[] | null,
): Promise<Buffer> {
  const theme = appThemes[input.themeId] ?? DEFAULT_THEME;
  const svg = await renderRideInviteSvg(
    rideInviteRenderInput(input, line),
    await storyCardFonts(theme),
  );
  return renderStoryCardPng(svg);
}
