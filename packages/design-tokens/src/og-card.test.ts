import { describe, expect, it } from 'vitest';

import { OG_CARD_TITLE_STEPS, ogCard } from './og-card.ts';

describe('ogCard — 1200×630', () => {
  it('колонка текста и плитка линии влезают по ширине и высоте', () => {
    const { size, insetX, insetY, columnGap, tile } = ogCard;
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(insetX * 2 + columnGap + tile.width).toBeLessThan(size.width);
    expect(tile.height).toBeLessThanOrEqual(size.height - 2 * insetY);
  });

  it('метка, 3 строки названия, 2 строки фактов и бренд — не выше кадра', () => {
    const { text, gaps, titleMaxLines, size, insetY, rule } = ogCard;
    const height =
      text.kicker.lineHeight +
      gaps.kickerUnderline +
      rule +
      gaps.title +
      titleMaxLines * text.title.lineHeight +
      gaps.facts +
      2 * text.fact.lineHeight +
      gaps.factLine +
      gaps.brandPadTop +
      rule +
      text.brand.lineHeight;
    expect(height).toBeLessThanOrEqual(size.height - 2 * insetY);
  });

  it('ступени названия: длиннее — мельче', () => {
    expect(OG_CARD_TITLE_STEPS.mid).toBeLessThan(OG_CARD_TITLE_STEPS.long);
    expect(ogCard.text.titleMid.size).toBeLessThan(ogCard.text.title.size);
    expect(ogCard.text.titleLong.size).toBeLessThan(ogCard.text.titleMid.size);
  });
});
