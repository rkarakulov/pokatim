import type { StoryCardTemplate } from '@pokatim/contracts';
import {
  badgeShape,
  storyCard,
  type StoryCardBadgeColors,
  type StoryCardColors,
} from '@pokatim/design-tokens';

import type { AchievementBadgeIcon } from './achievement-card.icons';
import type { AchievementCardTexts } from './achievement-card.texts';
import {
  box,
  node,
  page,
  type StoryCardChild,
  type StoryCardNode,
  text,
} from './story-card.render';

/**
 * Разметка карточки достижения (ADR-0018) — чистая функция без IO, узлы satori (только flex). Прототипа нет —
 * раскладки по образцу 3a/3b: `line` — метка с подчёркиванием, значок в ярусе 2, ярус 3 (название, условие, объект,
 * имя, дата), колонтитул; `night` — мастхед, значок и нижний блок. Значок «Эмаль» — как `achievement-badge.tsx`
 * приложения (пропорции `badgeShape`, цвета — роли темы).
 */

export interface AchievementCardRenderInput {
  template: StoryCardTemplate;
  colors: StoryCardColors;
  badgeColors: StoryCardBadgeColors;
  icon: AchievementBadgeIcon;
  texts: AchievementCardTexts;
}

/** Значок: круг фона с контуром текста, кольцо акцента, диск с глифом иконки; у счётных — число на кольце снизу. */
export function badgeNode(input: AchievementCardRenderInput, size: number): StoryCardNode {
  const { colors, badgeColors, icon } = input;
  const inset = size * badgeShape.ringInset;
  const disc = Math.round(size * badgeShape.disc);
  const glyph = Math.round(size * badgeShape.icon);
  return box(
    {
      position: 'relative',
      flexShrink: 0,
      width: size,
      height: size,
      borderRadius: size / 2,
      border: `${storyCard.achievement.badgeOutline}px solid ${colors.ink}`,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    [
      box({
        position: 'absolute',
        top: inset,
        left: inset,
        right: inset,
        bottom: inset,
        borderRadius: size / 2,
        border: `${size * badgeShape.ringWidth}px solid ${colors.accent}`,
      }),
      box(
        {
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: badgeColors.disc,
          alignItems: 'center',
          justifyContent: 'center',
        },
        [
          node(
            'div',
            {
              display: 'flex',
              fontFamily: 'symbols',
              fontWeight: 400,
              fontSize: glyph,
              lineHeight: `${glyph}px`,
              color: badgeColors.icon,
            },
            String.fromCodePoint(icon.glyph),
          ),
        ],
      ),
      icon.count === undefined
        ? null
        : box(
            {
              position: 'absolute',
              bottom: 0,
              paddingLeft: storyCard.achievement.metaGap,
              paddingRight: storyCard.achievement.metaGap,
              backgroundColor: colors.background,
            },
            [text(storyCard.text.badgeCount, colors.ink, String(icon.count))],
          ),
    ],
  );
}

/** Название (≤ 2 строк), условие, объект, имя (с согласием), дата — общий текст обоих шаблонов. */
function copy(input: AchievementCardRenderInput, titleGap: number): StoryCardChild[] {
  const { texts, colors } = input;
  const a = storyCard.achievement;
  const tokens = storyCard.text;
  return [
    text(tokens.achievementTitle, colors.ink, texts.title, {
      display: 'block',
      marginTop: titleGap,
      lineClamp: 2,
    }),
    text(tokens.achievementCondition, colors.muted, texts.condition, {
      display: 'block',
      marginTop: a.conditionGap,
      lineClamp: 2,
    }),
    texts.object === null
      ? null
      : text(tokens.achievementObject, colors.ink, texts.object, {
          display: 'block',
          marginTop: a.objectGap,
          lineClamp: 2,
        }),
    texts.riderName === null
      ? null
      : text(tokens.date, colors.ink, texts.riderName, {
          display: 'block',
          marginTop: texts.object === null ? a.objectGap : a.metaGap,
          lineClamp: 1,
        }),
    text(tokens.date, colors.muted, texts.date, {
      marginTop: texts.object === null && texts.riderName === null ? a.objectGap : a.metaGap,
    }),
  ];
}

/** «Линия»: метка с подчёркиванием, ярус 2 — значок по центру, ярус 3 — текст, колонтитул. */
function lineCard(input: AchievementCardRenderInput): StoryCardNode {
  const { texts, colors } = input;
  const g = storyCard.line;
  return page(colors, [
    box({ flexDirection: 'row', marginTop: g.tier1Top, flexShrink: 0 }, [
      text(storyCard.text.kicker, colors.accent, texts.kicker, {
        paddingBottom: g.kickerUnderlineGap,
        borderBottom: `${storyCard.rule}px solid ${colors.accent}`,
      }),
    ]),
    // ярус 2 — всё место между ярусами: длинный текст сжимает поле вокруг значка, а не колонтитул
    box(
      {
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: g.titleGap,
        marginBottom: g.titleGap,
      },
      [badgeNode(input, storyCard.achievement.badge)],
    ),
    box(
      {
        flexDirection: 'column',
        flexShrink: 0,
        borderTop: `${storyCard.rule}px solid ${colors.ink}`,
        paddingTop: g.tier3PadTop,
      },
      copy(input, 0),
    ),
    box(
      {
        flexShrink: 0,
        marginTop: storyCard.achievement.badgeGap,
        marginBottom: g.colophonBottom,
        paddingTop: g.colophonPadTop,
        borderTop: `${storyCard.rule}px solid ${colors.rule}`,
      },
      [text(storyCard.text.colophon, colors.ink, texts.brand)],
    ),
  ]);
}

/** «Ночь»: мастхед «ПОКАТИМ», нижний блок — значок, метка, текст. */
function nightCard(input: AchievementCardRenderInput): StoryCardNode {
  const { texts, colors } = input;
  const g = storyCard.night;
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
      badgeNode(input, storyCard.achievement.badgeNight),
      text(storyCard.text.kickerNight, colors.accent, texts.kicker, {
        marginTop: storyCard.achievement.badgeGap,
      }),
      ...copy(input, storyCard.achievement.titleGap),
    ]),
  ]);
}

/** Дерево карточки достижения для satori. */
export function achievementCardTree(input: AchievementCardRenderInput): StoryCardNode {
  return input.template === 'line' ? lineCard(input) : nightCard(input);
}
