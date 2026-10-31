import type { StoryCardTemplate } from '@pokatim/contracts';
import {
  STORY_CARD_TIME_STEPS,
  storyCard,
  type StoryCardColors,
  type StoryCardText,
} from '@pokatim/design-tokens';

import type { StoryCardTexts } from './story-card.texts';

/**
 * Разметка карточки для сторис (story-cards, ADR-0018) — чистая функция без IO и React: узлы `{ type, props }`, которые
 * понимает satori (только flex). Раскладки прототипа «27. Share / invite card 9:16»: `line` — 3b «карточка-линия»
 * (три яруса + колонтитул), `night` — 3a без фото (мастхед + нижний блок с плиткой трека). Геометрия — токены
 * `storyCard`, цвета — роли темы (`storyCardColors`), радиус 0 (точка старта — круг по смыслу).
 */

/** Узел satori: элемент с `style` и детьми (строка — текст). */
export interface StoryCardNode {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: StoryCardChild | StoryCardChild[];
    [attribute: string]: unknown;
  };
}
export type StoryCardChild = StoryCardNode | string | null;

/** Линия трека в координатах `viewBox` яруса (уже вписана — `contourPath`); старт — первая точка. */
export interface StoryCardTrack {
  view: { width: number; height: number };
  points: [number, number][];
  start: [number, number];
}

export interface StoryCardRenderInput {
  template: StoryCardTemplate;
  colors: StoryCardColors;
  texts: StoryCardTexts;
  track: StoryCardTrack | null;
  /** короткая ссылка приглашения `<домен>/i/<код>` справа от бренда (P6); нет кода или домена — `null` */
  address: string | null;
}

export const node = (
  type: string,
  style: Record<string, string | number>,
  children?: StoryCardChild | StoryCardChild[],
  attributes: Record<string, unknown> = {},
): StoryCardNode => ({ type, props: { ...attributes, style, children } });

export const box = (style: Record<string, string | number>, children?: StoryCardChild[]) =>
  node(
    'div',
    { display: 'flex', ...style },
    children?.filter((child) => child !== null),
  );

/** Текст стилем токена: семейство — роль (`display`/`text`, шрифты регистрирует `renderStoryCardSvg`). */
export function text(
  token: StoryCardText,
  color: string,
  value: string,
  extra: Record<string, string | number> = {},
): StoryCardNode {
  return node(
    'div',
    {
      display: 'flex',
      fontFamily: token.role,
      fontWeight: token.weight,
      fontSize: token.size,
      lineHeight: `${token.lineHeight}px`,
      color,
      ...(token.tracking !== undefined && { letterSpacing: token.tracking * token.size }),
      ...(token.uppercase && { textTransform: 'uppercase' }),
      ...extra,
    },
    value,
  );
}

/** Название (гонки, райда): перенос satori, не больше `titleMaxLines` строк с многоточием. */
export const titleText = (value: string, colors: StoryCardColors) =>
  node(
    'div',
    {
      display: 'block',
      fontFamily: storyCard.text.title.role,
      fontWeight: storyCard.text.title.weight,
      fontSize: storyCard.text.title.size,
      lineHeight: `${storyCard.text.title.lineHeight}px`,
      color: colors.ink,
      lineClamp: storyCard.titleMaxLines,
    },
    value,
  );

/** Ступень кегля времени по длине строки (RC-11: табличных цифр у satori нет). */
export function timeToken(time: string): StoryCardText {
  if (time.length >= STORY_CARD_TIME_STEPS.step9) return storyCard.text.timeStep9;
  if (time.length >= STORY_CARD_TIME_STEPS.step8) return storyCard.text.timeStep8;
  return storyCard.text.time;
}

/** Трек: `<svg viewBox>` с ломаной и точкой старта (круг с кольцом цвета фона); растягивается по блоку с пропорцией. */
export function trackSvg(
  track: StoryCardTrack,
  colors: StoryCardColors,
  strokeWidth: number,
  style: Record<string, string | number>,
): StoryCardNode {
  const radius = storyCard.line.startDot / 2;
  return node(
    'svg',
    style,
    [
      node('polyline', {}, undefined, {
        points: track.points.map(([x, y]) => `${x},${y}`).join(' '),
        fill: 'none',
        stroke: colors.track,
        'stroke-width': strokeWidth,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
      node('circle', {}, undefined, {
        cx: track.start[0],
        cy: track.start[1],
        r: radius,
        fill: colors.start,
        stroke: colors.background,
        'stroke-width': storyCard.line.startRing,
      }),
    ],
    {
      width: track.view.width,
      height: track.view.height,
      viewBox: `0 0 ${track.view.width} ${track.view.height}`,
      preserveAspectRatio: 'xMidYMid meet',
    },
  );
}

/**
 * Строка бренда (колонтитул «Линии», мастхед «Ночи»): бренд слева, короткая ссылка приглашения справа (P6, K9). Высота
 * строки адреса = высоте бренда (токен `address`): геометрия ярусов не меняется; без адреса — прежний узел бренда.
 */
export function brandRow(
  token: StoryCardText,
  colors: StoryCardColors,
  brand: string,
  address: string | null,
): StoryCardNode {
  if (address === null) return text(token, colors.ink, brand);
  // `flexGrow` — строка на всю ширину колонки и в строчном контейнере колонтитула/мастхеда
  return box(
    { flexDirection: 'row', flexGrow: 1, justifyContent: 'space-between', alignItems: 'center' },
    [
      text(token, colors.ink, brand, { flexShrink: 0 }),
      text(storyCard.text.address, colors.ink, address, {
        display: 'block',
        flexShrink: 1,
        minWidth: 0,
        marginLeft: storyCard.invite.unitGap,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }),
    ],
  );
}

/** Цифра карточки с единицей и подписью: «42» «км» «Дистанция». */
export interface CardStat {
  value: string;
  unit: string;
  label: string;
}

/**
 * Строка цифр приглашения и маршрута (1–N): цифра с единицей в строку, подпись ниже; между соседними — вертикальная
 * линия с полями. Верхняя линия (`rule`) — только у `night` (в `line` над строкой — линия яруса 3).
 */
export function statRow(
  items: readonly CardStat[],
  colors: StoryCardColors,
  { padTop, dividerPad, rule }: { padTop: number; dividerPad: number; rule: boolean },
): StoryCardNode {
  const stat = (item: CardStat, style: Record<string, string | number>) =>
    box({ flexDirection: 'column', flexBasis: 0, flexGrow: 1, flexShrink: 1, ...style }, [
      box({ flexDirection: 'row', alignItems: 'baseline' }, [
        text(storyCard.text.statValue, colors.ink, item.value),
        text(storyCard.text.statUnit, colors.muted, item.unit, {
          marginLeft: storyCard.invite.unitGap,
        }),
      ]),
      text(storyCard.text.statLabel, colors.muted, item.label),
    ]);
  return box(
    {
      flexDirection: 'row',
      ...(rule && { borderTop: `${storyCard.rule}px solid ${colors.rule}`, paddingTop: padTop }),
    },
    items.map((item, index) =>
      stat(
        item,
        index < items.length - 1
          ? {
              paddingRight: dividerPad,
              marginRight: dividerPad,
              borderRight: `${storyCard.rule}px solid ${colors.rule}`,
            }
          : {},
      ),
    ),
  );
}

/** Пара «место · группа»: без места — только группа; разделитель — вертикальная линия с полями. */
function stats(
  texts: StoryCardTexts,
  colors: StoryCardColors,
  padTop: number,
  dividerPad: number,
): StoryCardNode {
  const stat = (value: string, label: string, style: Record<string, string | number>) =>
    box({ flexDirection: 'column', ...style }, [
      text(storyCard.text.statValue, colors.ink, value),
      text(storyCard.text.statLabel, colors.muted, label),
    ]);
  return box(
    {
      flexDirection: 'row',
      borderTop: `${storyCard.rule}px solid ${colors.rule}`,
      paddingTop: padTop,
    },
    [
      texts.place === null
        ? null
        : stat(texts.place, texts.placeLabel, {
            flexShrink: 0,
            paddingRight: dividerPad,
            marginRight: dividerPad,
            borderRight: `${storyCard.rule}px solid ${colors.rule}`,
          }),
      stat(texts.group, texts.groupLabel, { flexGrow: 1, flexShrink: 1 }),
    ],
  );
}

/** Метка (kicker), название, имя (с согласием), дата — общий верх обоих шаблонов. */
function heading(
  input: StoryCardRenderInput,
  kicker: StoryCardNode,
  dateToken: StoryCardText,
  gaps: { titleGap: number; dateGap: number },
): StoryCardChild[] {
  const { texts, colors } = input;
  return [
    kicker,
    box({ flexDirection: 'column', marginTop: gaps.titleGap }, [titleText(texts.title, colors)]),
    texts.riderName === null
      ? null
      : text(storyCard.text.date, colors.ink, texts.riderName, {
          display: 'block',
          marginTop: gaps.dateGap,
          lineClamp: 1,
        }),
    text(dateToken, colors.muted, texts.date, { marginTop: gaps.dateGap }),
  ];
}

/** Фон на весь кадр и колонка контента шириной `width − 2 × insetX` по центру (линии ярусов — по колонке). */
export const page = (colors: StoryCardColors, children: StoryCardChild[]) =>
  box(
    {
      flexDirection: 'column',
      alignItems: 'center',
      width: storyCard.size.width,
      height: storyCard.size.height,
      backgroundColor: colors.background,
    },
    [
      box(
        {
          flexDirection: 'column',
          flexGrow: 1,
          width: storyCard.size.width - 2 * storyCard.insetX,
        },
        children,
      ),
    ],
  );

/** 3b «Линия»: ярус 1 (метка с подчёркиванием, название, дата), ярус 2 (линия), ярус 3 (время, пара), колонтитул. */
function lineCard(input: StoryCardRenderInput): StoryCardNode {
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
      heading(input, kicker, storyCard.text.date, g),
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
        text(timeToken(texts.time), colors.ink, texts.time),
        box({ flexDirection: 'column', marginTop: g.statPadTop }, [
          stats(texts, colors, g.statPadTop, g.statDividerPad),
        ]),
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

/** 3a «Ночь» без фото: мастхед «ПОКАТИМ», нижний блок — метка, название, дата, плитка трека, время, пара. */
function nightCard(input: StoryCardRenderInput): StoryCardNode {
  const { texts, colors, track } = input;
  const g = storyCard.night;
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
        storyCard.text.dateNight,
        g,
      ),
      track
        ? box(
            {
              marginTop: g.tileGap,
              height: g.tileHeight,
              alignItems: 'center',
              justifyContent: 'center',
            },
            [trackSvg(track, colors, g.tileStroke, { width: '100%', height: g.tileHeight })],
          )
        : null,
      text(timeToken(texts.time), colors.ink, texts.time, { marginTop: g.tileGap }),
      box({ flexDirection: 'column', marginTop: g.statsGap }, [
        stats(texts, colors, g.statPadTop, g.statDividerPad),
      ]),
    ]),
  ]);
}

/** Дерево карточки для satori. */
export function storyCardTree(input: StoryCardRenderInput): StoryCardNode {
  return input.template === 'line' ? lineCard(input) : nightCard(input);
}

/** viewBox трека шаблона (`contourPath` вписывает линию с полем в половину толщины + точка старта). */
export function storyCardTrackView(template: StoryCardTemplate): {
  width: number;
  height: number;
  padding: number;
} {
  const padding = storyCard.line.startDot;
  return template === 'line'
    ? { width: storyCard.line.tier2Width, height: storyCard.line.tier2Height, padding }
    : {
        width: storyCard.size.width - 2 * storyCard.insetX,
        height: storyCard.night.tileHeight,
        padding,
      };
}

/** viewBox линии приглашения и маршрута: `line` — ярус 2 сторис, `night` — плитка приглашения (ниже плитки сторис). */
export function cardTrackView(template: StoryCardTemplate): {
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
