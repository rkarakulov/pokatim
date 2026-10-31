import { describe, expect, it } from 'vitest';

import { APP_FONT_FILE_IDS, appFontFaces, fontFilesOf } from './app-fonts.ts';
import { appThemes } from './app-themes.ts';
import { storyCard, storyCardBadgeColors, storyCardColors } from './story-card.ts';

describe('storyCard — прототип 360×640 × 3', () => {
  it('экспорт 1080×1920, поле 60, линия 3', () => {
    expect(storyCard.size).toEqual({ width: 1080, height: 1920 });
    expect(storyCard.insetX).toBe(20 * 3);
    expect(storyCard.rule).toBe(1 * 3);
  });

  it('время 72/74 превью и ступени 60/64, 52/56 (card-time.step-60/52)', () => {
    expect(storyCard.text.time).toMatchObject({ size: 216, lineHeight: 222 });
    expect(storyCard.text.timeStep8).toMatchObject({ size: 180, lineHeight: 192 });
    expect(storyCard.text.timeStep9).toMatchObject({ size: 156, lineHeight: 168 });
  });

  it('строка адреса приглашения — высотой колонтитула и мастхеда (P6)', () => {
    expect(storyCard.text.address.lineHeight).toBe(storyCard.text.colophon.lineHeight);
    expect(storyCard.text.address.lineHeight).toBe(storyCard.text.masthead.lineHeight);
    expect(storyCard.text.address.size).toBeLessThan(storyCard.text.colophon.size);
  });

  it('ярус линии вписан в карточку', () => {
    expect(storyCard.line.tier2Width).toBe(storyCard.size.width - 2 * storyCard.insetX);
  });
});

describe('storyCardColors', () => {
  it('7 тем × 2 схемы — все роли заданы', () => {
    for (const def of Object.values(appThemes)) {
      for (const scheme of [def.schemes.light, def.schemes.dark]) {
        const colors = storyCardColors(scheme);
        for (const value of Object.values(colors)) expect(typeof value).toBe('string');
        expect(colors.background).toBe(scheme.surface.default);
        expect(colors.ink).toBe(scheme.text.primary);
      }
    }
  });
});

describe('storyCardBadgeColors', () => {
  it('диск и иконка — роли действия схемы (как значок приложения)', () => {
    for (const def of Object.values(appThemes)) {
      for (const scheme of [def.schemes.light, def.schemes.dark]) {
        expect(storyCardBadgeColors(scheme)).toEqual({
          disc: scheme.action.primary,
          icon: scheme.action.onPrimary,
        });
      }
    }
  });

  it('значок достижения вписан в ширину колонки', () => {
    const column = storyCard.size.width - 2 * storyCard.insetX;
    expect(storyCard.achievement.badge).toBeLessThanOrEqual(column);
    expect(storyCard.achievement.badgeNight).toBeLessThan(storyCard.achievement.badge);
  });
});

describe('appFontFaces', () => {
  it('у каждой темы есть display 500/600 и text 500/600', () => {
    for (const def of Object.values(appThemes)) {
      expect(Object.keys(fontFilesOf('display', def.fonts.display))).toEqual(
        expect.arrayContaining(['500', '600']),
      );
      expect(Object.keys(fontFilesOf('text', def.fonts.text))).toEqual(
        expect.arrayContaining(['500', '600']),
      );
    }
  });

  it('все файлы таблицы — из списка id', () => {
    const ids = new Set<string>(APP_FONT_FILE_IDS);
    const used = Object.values(appFontFaces).flatMap((roles) =>
      Object.values(roles).flatMap((files) => Object.values(files)),
    );
    for (const id of used) expect(ids.has(id)).toBe(true);
  });

  it('незнакомая гарнитура — ошибка', () => {
    expect(() => fontFilesOf('display', 'Comic Sans')).toThrow(/Comic Sans/);
  });
});
