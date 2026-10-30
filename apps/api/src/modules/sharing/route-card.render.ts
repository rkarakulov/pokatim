import type { StoryCardTemplate } from '@pokatim/contracts';
import { storyCard, type StoryCardColors, type StoryCardText } from '@pokatim/design-tokens';

import type { RouteCardTexts } from './route-card.texts';
import {
  box,
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
 * Разметка карточки маршрута каталога для сторис (ADR-0018, route-story-card) — чистая функция без IO, узлы satori
 * (только flex). Прототипа нет: раскладки приглашения без даты и времени — `line` 4b (ярус 1 — метка, название,
 * «город · форма»; ярус 2 — линия; ярус 3 — пара; колонтитул), `night` 4a без фото (мастхед + нижний блок с плиткой
 * линии). Общие узлы, строка цифр и геометрия — `story-card.render.ts`, токены `storyCard` (`line`, `night`, `invite`).
 */

export interface RouteCardRenderInput {
  template: StoryCardTemplate;
  colors: StoryCardColors;
  texts: RouteCardTexts;
  /** линия показа маршрута каталога (нет линии — задача `skipped`); вырожденная (точка) — ярус/плитка пусты */
  track: StoryCardTrack | null;
}

/** Метка, название, «город · форма» — общий верх обоих шаблонов. */
function heading(
  input: RouteCardRenderInput,
  kicker: StoryCardNode,
  placeToken: StoryCardText,
  titleGap: number,
): StoryCardChild[] {
  const { texts, colors } = input;
  return [
    kicker,
    box({ flexDirection: 'column', marginTop: titleGap }, [titleText(texts.title, colors)]),
    text(placeToken, colors.muted, texts.place, {
      display: 'block',
      marginTop: storyCard.invite.dateGap,
      lineClamp: 1,
    }),
  ];
}

/** 4b-подобный «Линия»: ярус 1 сверху, линия — всё место между ярусами, ярус 3 — пара, колонтитул. */
function lineCard(input: RouteCardRenderInput): StoryCardNode {
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
      [statRow(texts.stats, colors, { padTop: 0, dividerPad: g.statDividerPad, rule: false })],
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

/** 4a-подобный без фото: мастхед «ПОКАТИМ», нижний блок — метка, название, «город · форма», плитка линии, пара. */
function nightCard(input: RouteCardRenderInput): StoryCardNode {
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
        statRow(texts.stats, colors, {
          padTop: g.statPadTop,
          dividerPad: g.statDividerPad,
          rule: true,
        }),
      ]),
    ]),
  ]);
}

/** Дерево карточки маршрута для satori. */
export function routeCardTree(input: RouteCardRenderInput): StoryCardNode {
  return input.template === 'line' ? lineCard(input) : nightCard(input);
}
