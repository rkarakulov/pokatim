import type { FontRole } from '@rkarakulov/design-tokens';

import type { AppTheme } from './brand.ts';

/**
 * Карточка для сторис (story-cards, ADR-0018): PNG 1080×1920 = превью прототипа 360×640 × 3. Геометрия — px экспорта
 * (значения прототипа «27. Share / invite card 9:16» × 3), `tracking` — em. Рендер — сервер (satori), цвета и
 * гарнитуры — активной темы (`storyCardColors`, `AppThemeDefinition.fonts`). Изменил значение — подними
 * `renderVersion` карточки в API (`STORY_CARD_POLICY`), иначе 24 ч отдаётся старая картинка.
 */
export interface StoryCardText {
  role: FontRole;
  weight: 500 | 600;
  size: number;
  lineHeight: number;
  /** em */
  tracking?: number;
  uppercase?: boolean;
}

/** Ступени кегля времени по длине строки (RC-11: табличных цифр в satori нет — выбор по символам, не по ширине). */
export const STORY_CARD_TIME_STEPS = { step8: 8, step9: 9 } as const;

export const storyCard = {
  size: { width: 1080, height: 1920 },
  insetX: 60,
  /** 1 px превью: линии мастхеда, колонтитула, разделитель пары, подчёркивание метки */
  rule: 3,
  titleMaxLines: 3,
  trackMaxPoints: 500,
  text: {
    masthead: {
      role: 'display',
      weight: 600,
      size: 45,
      lineHeight: 54,
      tracking: 0.2,
      uppercase: true,
    },
    colophon: {
      role: 'display',
      weight: 600,
      size: 45,
      lineHeight: 54,
      tracking: 0.2,
      uppercase: true,
    },
    kicker: {
      role: 'text',
      weight: 600,
      size: 33,
      lineHeight: 42,
      tracking: 0.18,
      uppercase: true,
    },
    kickerNight: {
      role: 'text',
      weight: 600,
      size: 39,
      lineHeight: 48,
      tracking: 0.12,
      uppercase: true,
    },
    title: { role: 'display', weight: 500, size: 75, lineHeight: 87 },
    date: { role: 'text', weight: 500, size: 37.5, lineHeight: 51 },
    dateNight: { role: 'text', weight: 600, size: 39, lineHeight: 51 },
    time: { role: 'display', weight: 600, size: 216, lineHeight: 222 },
    timeStep8: { role: 'display', weight: 600, size: 180, lineHeight: 192 },
    timeStep9: { role: 'display', weight: 600, size: 156, lineHeight: 168 },
    statValue: { role: 'display', weight: 600, size: 66, lineHeight: 78 },
    statLabel: {
      role: 'text',
      weight: 600,
      size: 33,
      lineHeight: 42,
      tracking: 0.14,
      uppercase: true,
    },
  } satisfies Record<string, StoryCardText>,
  night: {
    mastheadTop: 48,
    /** [ASSUMPTION] RC-10: в прототипе значения нет */
    mastheadPadBottom: 24,
    copyBottom: 66,
    titleGap: 24,
    dateGap: 12,
    tileGap: 30,
    tileHeight: 360,
    tileStroke: 7.2,
    statsGap: 24,
    statPadTop: 24,
    statDividerPad: 36,
  },
  line: {
    tier1Top: 72,
    /** [ASSUMPTION] */
    kickerUnderlineGap: 6,
    titleGap: 24,
    dateGap: 12,
    tier2Top: 408,
    tier2Height: 900,
    tier2Width: 960,
    trackStroke: 9,
    /** [ASSUMPTION] RC-10: точка старта Ø 8 px превью, обводка цветом фона 2 px */
    startDot: 24,
    startRing: 6,
    tier3Bottom: 168,
    tier3PadTop: 18,
    statPadTop: 24,
    statDividerPad: 36,
    colophonBottom: 48,
    colophonPadTop: 21,
  },
} as const;

/** Цвета карточки — роли схемы темы (без hex): фон, текст, вторичный, акцент, линии, трек, точка старта. */
export interface StoryCardColors {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  rule: string;
  track: string;
  start: string;
}

export function storyCardColors(scheme: AppTheme): StoryCardColors {
  return {
    background: scheme.surface.default,
    ink: scheme.text.primary,
    muted: scheme.text.secondary,
    accent: scheme.text.accent,
    rule: scheme.border.strong,
    track: scheme.text.primary,
    start: scheme.text.accent,
  };
}
