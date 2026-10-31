import type { StoryCardTemplate } from '@pokatim/contracts';
import { storyCard, type StoryCardColors, type StoryCardText } from '@pokatim/design-tokens';

import type { RideInviteTexts } from './ride-invite.texts';
import {
  box,
  brandRow,
  page,
  statRow,
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
  /** короткая ссылка приглашения `<домен>/i/<код>` справа от бренда (P6); нет кода или домена — `null` */
  address: string | null;
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
      [
        statRow([texts.distance, texts.pace], colors, {
          padTop: 0,
          dividerPad: g.statDividerPad,
          rule: false,
        }),
      ],
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
      [brandRow(storyCard.text.colophon, colors, texts.brand, input.address)],
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
      [brandRow(storyCard.text.masthead, colors, texts.brand, input.address)],
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
        statRow([texts.distance, texts.pace], colors, {
          padTop: g.statPadTop,
          dividerPad: g.statDividerPad,
          rule: true,
        }),
      ]),
    ]),
  ]);
}

/** Дерево карточки-приглашения для satori. */
export function rideInviteTree(input: RideInviteRenderInput): StoryCardNode {
  return input.template === 'line' ? lineCard(input) : nightCard(input);
}
