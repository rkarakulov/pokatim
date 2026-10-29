import type { StoryCardText } from './story-card.ts';

/**
 * OG-картинка публичной страницы (og-images, ADR-0018): PNG 1200×630, светлая схема темы, гарнитуры темы. Слева —
 * колонка текста (метка вида, название ступенями кегля, 1–2 строки фактов, бренд внизу), справа — плитка линии
 * маршрута (нет линии — текст во всю ширину). Прототипа OG нет — значения `[ASSUMPTION]` (масштаб от `storyCard`),
 * утверждены превью (`preview:story-cards`). Изменил значение — подними `OG_CARD_POLICY.renderVersion` в API.
 */
export const OG_CARD_TITLE_STEPS = { mid: 34, long: 60 } as const;

export const ogCard = {
  size: { width: 1200, height: 630 },
  insetX: 72,
  insetY: 64,
  /** зазор колонки текста и плитки линии */
  columnGap: 56,
  /** линия над брендом и подчёркивание метки */
  rule: 3,
  titleMaxLines: 3,
  trackMaxPoints: 500,
  /** отступы колонки текста: метка → название, название → факты, между строками фактов */
  gaps: { kickerUnderline: 6, title: 24, facts: 24, factLine: 4, brandPadTop: 18 },
  /** точка старта и её кольцо — как у сторис (`trackSvg`) */
  tile: { width: 440, height: 502, padding: 24, stroke: 7 },
  text: {
    kicker: {
      role: 'text',
      weight: 600,
      size: 24,
      lineHeight: 30,
      tracking: 0.16,
      uppercase: true,
    },
    title: { role: 'display', weight: 600, size: 60, lineHeight: 68 },
    titleMid: { role: 'display', weight: 600, size: 50, lineHeight: 58 },
    titleLong: { role: 'display', weight: 600, size: 42, lineHeight: 50 },
    fact: { role: 'text', weight: 500, size: 28, lineHeight: 38 },
    brand: {
      role: 'display',
      weight: 600,
      size: 28,
      lineHeight: 34,
      tracking: 0.2,
      uppercase: true,
    },
  } satisfies Record<string, StoryCardText>,
} as const;
