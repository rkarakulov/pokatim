import type { LonLat } from '@pokatim/contracts';
import {
  appThemes,
  DEFAULT_THEME,
  photoScrim,
  storyCard,
  storyCardColors,
} from '@pokatim/design-tokens';

import { composeWithPhoto, onPhotoColors } from './photo-card.png';
import type { RideInviteInput } from './ride-invite.inputs';
import { type RideInviteRenderInput, rideInviteTree } from './ride-invite.render';
import { rideInviteTexts } from './ride-invite.texts';
import { type StoryCardFont, storyCardFonts } from './story-card.fonts';
import { STORY_CARD_POLICY } from './sharing.policy';
import { renderCardSvg, renderStoryCardPng, storyCardTrack } from './story-card.png';
import { cardTrackView } from './story-card.render';

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
    address: input.address,
  };
}

export function renderRideInviteSvg(
  input: RideInviteRenderInput,
  fonts: StoryCardFont[],
): Promise<string> {
  return renderCardSvg(rideInviteTree(input), fonts);
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
  // 4a (ride-photo): фото `cover` 1080×1920, скрим `photoScrim`, предел сторис
  return composeWithPhoto(photo, svg, {
    size: storyCard.size,
    scrimColor: theme.schemes.dark.overlay.scrim,
    profile: photoScrim,
    maxBytes: STORY_CARD_POLICY.maxPngBytes,
  });
}
