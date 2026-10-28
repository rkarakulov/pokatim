import type { StoryCardTemplate } from '@pokatim/contracts';
import { storyCard, type StoryCardColors, type StoryCardText } from '@pokatim/design-tokens';

import type { RideInviteStat, RideInviteTexts } from './ride-invite.texts';
import {
  box,
  page,
  type StoryCardChild,
  type StoryCardNode,
  type StoryCardTrack,
  text,
  titleText,
  trackSvg,
} from './story-card.render';

/**
 * Разметка карточки-приглашения кофе-райда (ADR-0018) — чистая функция без IO, узлы satori (только flex). Раскладки
 * прототипа «Кофе-райды» (d): `line` — 4b «карточка-линия» (ярус 1 — метка, название, дата, время, старт; ярус 2 —
 * линия маршрута; ярус 3 — пара; колонтитул), `night` — 4a без фото (мастхед + нижний блок с плиткой линии). Общие
 * узлы и геометрия — карточки для сторис (`story-card.render.ts`, токены `storyCard`).
 */

export interface RideInviteRenderInput {
  template: StoryCardTemplate;
  colors: StoryCardColors;
  texts: RideInviteTexts;
  /** линия публичного маршрута; нет — ярус/плитка пусты, старт — текстом */
  track: StoryCardTrack | null;
}

/**
 * Пара «дистанция · темп»: цифра с единицей в строку, подпись ниже; разделитель — вертикальная линия с полями. Верхняя
 * линия — только у `night` (в 4b над парой — линия яруса 3).
 */
function stats(
  texts: RideInviteTexts,
  colors: StoryCardColors,
  { padTop, dividerPad, rule }: { padTop: number; dividerPad: number; rule: boolean },
) {
  const stat = (item: RideInviteStat, style: Record<string, string | number>) =>
    box({ flexDirection: 'column', flexBasis: 0, flexGrow: 1, flexShrink: 1, ...style }, [
      box({ flexDirection: 'row', alignItems: 'baseline' }, [
        text(storyCard.text.statValue, colors.ink, item.value),
        text(storyCard.text.statUnit, colors.muted, item.unit, { marginLeft: 12 }),
      ]),
      text(storyCard.text.statLabel, colors.muted, item.label),
    ]);
  return box(
    {
      flexDirection: 'row',
      ...(rule && { borderTop: `${storyCard.rule}px solid ${colors.rule}`, paddingTop: padTop }),
    },
    [
      stat(texts.distance, {
        paddingRight: dividerPad,
        marginRight: dividerPad,
        borderRight: `${storyCard.rule}px solid ${colors.rule}`,
      }),
      stat(texts.pace, {}),
    ],
  );
}

/** Метка, название, дата, время, старт — общий верх обоих шаблонов. */
function heading(
  input: RideInviteRenderInput,
  kicker: StoryCardNode,
  startToken: StoryCardText,
  titleGap: number,
): StoryCardChild[] {
  const { texts, colors } = input;
  const g = storyCard.invite;
  return [
    kicker,
    box({ flexDirection: 'column', marginTop: titleGap }, [titleText(texts.title, colors)]),
    text(storyCard.text.inviteDate, colors.ink, texts.date, { marginTop: g.dateGap }),
    text(storyCard.text.inviteTime, colors.ink, texts.time, { marginTop: g.timeGap }),
    text(startToken, colors.muted, texts.start, {
      display: 'block',
      marginTop: g.startGap,
      lineClamp: 2,
    }),
  ];
}

/** 4b «Линия»: ярус 1 сверху, линия — всё место между ярусами, ярус 3 — пара, колонтитул. */
function lineCard(input: RideInviteRenderInput): StoryCardNode {
  const { texts, colors, track } = input;
  const g = storyCard.line;
  const kicker = box({ flexDirection: 'row' }, [
    text(storyCard.text.kicker, colors.accent, texts.kicker, {
      paddingBottom: g.kickerUnderlineGap,
      borderBottom: `${storyCard.rule}px solid ${colors.accent}`,
    }),
  ]);
  return page(colors, [
    box(
      { flexDirection: 'column', marginTop: g.tier1Top, flexShrink: 0 },
      heading(input, kicker, storyCard.text.inviteStart, g.titleGap),
    ),
    // ярус 2 — всё место между ярусами: длинное название сжимает линию, а не колонтитул (линия вписана с пропорцией)
    box(
      {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minHeight: 0,
        position: 'relative',
        marginTop: g.titleGap,
        marginBottom: g.titleGap,
      },
      [
        track
          ? trackSvg(track, colors, g.trackStroke, {
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
            })
          : null,
      ],
    ),
    box(
      {
        flexDirection: 'column',
        flexShrink: 0,
        borderTop: `${storyCard.rule}px solid ${colors.ink}`,
        paddingTop: g.tier3PadTop,
      },
      [stats(texts, colors, { padTop: 0, dividerPad: g.statDividerPad, rule: false })],
    ),
    box(
      {
        flexShrink: 0,
        marginTop:
          g.tier3Bottom - g.colophonBottom - storyCard.text.colophon.lineHeight - g.colophonPadTop,
        marginBottom: g.colophonBottom,
        paddingTop: g.colophonPadTop,
        borderTop: `${storyCard.rule}px solid ${colors.rule}`,
      },
      [text(storyCard.text.colophon, colors.ink, texts.brand)],
    ),
  ]);
}

/** 4a без фото: мастхед «ПОКАТИМ», нижний блок — метка, название, дата, время, старт, плитка линии, пара. */
function nightCard(input: RideInviteRenderInput): StoryCardNode {
  const { texts, colors, track } = input;
  const g = storyCard.night;
  const tile = storyCard.invite.tileHeight;
  return page(colors, [
    box(
      {
        flexShrink: 0,
        marginTop: g.mastheadTop,
        paddingBottom: g.mastheadPadBottom,
        borderBottom: `${storyCard.rule}px solid ${colors.rule}`,
      },
      [text(storyCard.text.masthead, colors.ink, texts.brand)],
    ),
    box({ flexGrow: 1, flexShrink: 1, minHeight: 0 }),
    box({ flexDirection: 'column', flexShrink: 0, marginBottom: g.copyBottom }, [
      ...heading(
        input,
        text(storyCard.text.kickerNight, colors.accent, texts.kicker),
        storyCard.text.inviteStartNight,
        g.titleGap,
      ),
      track
        ? box(
            { marginTop: g.tileGap, height: tile, alignItems: 'center', justifyContent: 'center' },
            [trackSvg(track, colors, g.tileStroke, { width: '100%', height: tile })],
          )
        : null,
      box({ flexDirection: 'column', marginTop: g.tileGap }, [
        stats(texts, colors, { padTop: g.statPadTop, dividerPad: g.statDividerPad, rule: true }),
      ]),
    ]),
  ]);
}

/** Дерево карточки-приглашения для satori. */
export function rideInviteTree(input: RideInviteRenderInput): StoryCardNode {
  return input.template === 'line' ? lineCard(input) : nightCard(input);
}

/** viewBox линии шаблона: `line` — ярус 2 сторис, `night` — плитка приглашения (ниже плитки сторис). */
export function rideInviteTrackView(template: StoryCardTemplate): {
  width: number;
  height: number;
  padding: number;
} {
  const padding = storyCard.line.startDot;
  return template === 'line'
    ? { width: storyCard.line.tier2Width, height: storyCard.line.tier2Height, padding }
    : {
        width: storyCard.size.width - 2 * storyCard.insetX,
        height: storyCard.invite.tileHeight,
        padding,
      };
}
