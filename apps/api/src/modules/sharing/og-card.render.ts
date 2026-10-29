import {
  OG_CARD_TITLE_STEPS,
  ogCard,
  type StoryCardColors,
  type StoryCardText,
} from '@pokatim/design-tokens';

import type { OgBrandTexts, OgCardTexts } from './og-card.texts';
import {
  box,
  node,
  type StoryCardChild,
  type StoryCardNode,
  type StoryCardTrack,
  text,
  trackSvg,
} from './story-card.render';

/**
 * Разметка OG-картинки 1200×630 (og-images, ADR-0018) — чистые функции без IO и React, узлы satori (только flex).
 * Слева — колонка текста: метка вида с подчёркиванием, название (ступени кегля, ≤ 3 строк), 1–2 строки фактов, внизу —
 * линия и бренд; справа — плитка с линией публичного маршрута (нет линии — колонка во всю ширину). Узлы и линия —
 * общие с карточкой для сторис (`story-card.render.ts`), геометрия — токены `ogCard`.
 */

export interface OgCardRenderInput {
  colors: StoryCardColors;
  texts: OgCardTexts;
  track: StoryCardTrack | null;
}

export interface OgBrandRenderInput {
  colors: StoryCardColors;
  texts: OgBrandTexts;
}

/** Ступень кегля названия по длине (символы — как `timeToken` сторис: ширину satori заранее не знает). */
export function ogTitleToken(title: string): StoryCardText {
  if (title.length >= OG_CARD_TITLE_STEPS.long) return ogCard.text.titleLong;
  if (title.length >= OG_CARD_TITLE_STEPS.mid) return ogCard.text.titleMid;
  return ogCard.text.title;
}

/** Блок текста с переносом satori и многоточием после `lines` строк. */
const clamped = (token: StoryCardText, color: string, value: string, lines: number) =>
  node(
    'div',
    {
      display: 'block',
      fontFamily: token.role,
      fontWeight: token.weight,
      fontSize: token.size,
      lineHeight: `${token.lineHeight}px`,
      color,
      lineClamp: lines,
    },
    value,
  );

/**
 * Фон на весь кадр и область контента `size − 2 × inset` по центру (поля — размером области, не `padding`: у satori
 * `padding` прибавляется к `width`); дети — в ряд (колонка текста + плитка).
 */
const frame = (colors: StoryCardColors, children: StoryCardChild[]) =>
  box(
    {
      alignItems: 'center',
      justifyContent: 'center',
      width: ogCard.size.width,
      height: ogCard.size.height,
      backgroundColor: colors.background,
    },
    [
      box(
        {
          flexDirection: 'row',
          width: ogCard.size.width - 2 * ogCard.insetX,
          height: ogCard.size.height - 2 * ogCard.insetY,
        },
        children,
      ),
    ],
  );

/** Колонка текста: верх (метка, название, факты) и бренд внизу под линией; `brand: null` — без колонтитула. */
function column(
  colors: StoryCardColors,
  top: StoryCardChild[],
  brand: string | null,
  width: number,
): StoryCardNode {
  return box({ flexDirection: 'column', flexShrink: 0, width }, [
    box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minHeight: 0 }, top),
    brand === null
      ? null
      : box(
          {
            flexShrink: 0,
            paddingTop: ogCard.gaps.brandPadTop,
            borderTop: `${ogCard.rule}px solid ${colors.rule}`,
          },
          [text(ogCard.text.brand, colors.ink, brand)],
        ),
  ]);
}

/** Строки фактов: первая — основным цветом, вторая — вторичным; каждая — в одну строку с многоточием. */
const factLines = (facts: readonly string[], colors: StoryCardColors) =>
  box(
    { flexDirection: 'column', marginTop: ogCard.gaps.facts },
    facts.map((line, index) =>
      box({ flexDirection: 'column', marginTop: index === 0 ? 0 : ogCard.gaps.factLine }, [
        clamped(ogCard.text.fact, index === 0 ? colors.ink : colors.muted, line, 1),
      ]),
    ),
  );

/** Метка вида с подчёркиванием акцентом (как ярус 1 «карточки-линии»). */
const kicker = (value: string, colors: StoryCardColors) =>
  box({ flexDirection: 'row' }, [
    text(ogCard.text.kicker, colors.accent, value, {
      paddingBottom: ogCard.gaps.kickerUnderline,
      borderBottom: `${ogCard.rule}px solid ${colors.accent}`,
    }),
  ]);

/** Плитка линии маршрута справа: размер `ogCard.tile`, линия вписана с пропорцией. */
const tile = (track: StoryCardTrack, colors: StoryCardColors) =>
  box(
    {
      flexShrink: 0,
      width: ogCard.tile.width,
      height: ogCard.tile.height,
      marginLeft: ogCard.columnGap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    [
      trackSvg(track, colors, ogCard.tile.stroke, {
        width: ogCard.tile.width,
        height: ogCard.tile.height,
      }),
    ],
  );

/** Ширина колонки текста: с плиткой — остаток после плитки и зазора; без — вся область контента. */
export const textWidth = (withTile: boolean) =>
  ogCard.size.width - 2 * ogCard.insetX - (withTile ? ogCard.columnGap + ogCard.tile.width : 0);

/** OG-картинка объекта. */
export function ogCardTree(input: OgCardRenderInput): StoryCardNode {
  const { texts, colors, track } = input;
  const title = ogTitleToken(texts.title);
  return frame(colors, [
    column(
      colors,
      [
        kicker(texts.kicker, colors),
        box({ flexDirection: 'column', marginTop: ogCard.gaps.title }, [
          clamped(title, colors.ink, texts.title, ogCard.titleMaxLines),
        ]),
        factLines(texts.facts, colors),
      ],
      texts.brand,
      textWidth(track !== null),
    ),
    track ? tile(track, colors) : null,
  ]);
}

/** Бренд-картинка: название крупно и слоган по центру; колонтитула нет — название и есть бренд. */
export function ogBrandTree(input: OgBrandRenderInput): StoryCardNode {
  const { texts, colors } = input;
  return frame(colors, [
    column(
      colors,
      [
        box({ flexGrow: 1 }),
        clamped(ogCard.text.title, colors.ink, texts.title, 1),
        box({ flexDirection: 'column', marginTop: ogCard.gaps.facts }, [
          clamped(ogCard.text.fact, colors.muted, texts.tagline, 2),
        ]),
        box({ flexGrow: 1 }),
      ],
      null,
      textWidth(false),
    ),
  ]);
}

/** viewBox плитки линии (`contourPath` вписывает линию с полем). */
export const ogTileView = () => ({
  width: ogCard.tile.width,
  height: ogCard.tile.height,
  padding: ogCard.tile.padding,
});
