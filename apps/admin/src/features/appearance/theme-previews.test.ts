import { APP_THEME_IDS } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { previewOf, THEME_PREVIEWS } from './theme-previews';

describe('превью тем в панели (app-themes C1, AC8)', () => {
  it('ключи — APP_THEME_IDS в том же порядке, у каждой темы — цветное превью', () => {
    expect(Object.keys(THEME_PREVIEWS)).toEqual([...APP_THEME_IDS]);
    for (const id of APP_THEME_IDS) expect(THEME_PREVIEWS[id]).toEqual(previewOf(appThemes[id]));
  });

  it('превью — роли схем темы из реестра: «по системе» — светлая и тёмная, «всегда тёмная» — одна', () => {
    for (const def of Object.values(appThemes)) {
      const schemes =
        def.colorScheme === 'dark' ? [def.schemes.dark] : [def.schemes.light, def.schemes.dark];
      expect(previewOf(def)).toEqual({
        colorScheme: def.colorScheme,
        mocks: schemes.map((scheme) => ({
          canvas: scheme.surface.default,
          card: scheme.surface.raised,
          text: scheme.text.primary,
          accent: scheme.action.primary,
          route: scheme.map.route,
          radius: scheme.shape.card,
        })),
        font: def.fonts.display,
      });
    }
    expect(THEME_PREVIEWS.chrono.mocks).toHaveLength(1);
    expect(THEME_PREVIEWS.journal.mocks).toHaveLength(2);
  });

  it('тёмный Журнал не совпадает с Навигацией: фон, карточка и акцент разные', () => {
    const [, journalDark] = THEME_PREVIEWS.journal.mocks;
    const [navigation] = THEME_PREVIEWS.navigation.mocks;
    expect(journalDark?.canvas).not.toBe(navigation?.canvas);
    expect(journalDark?.card).not.toBe(navigation?.card);
    expect(journalDark?.accent).not.toBe(navigation?.accent);
  });

  it('у тем разные превью', () => {
    const canvases = new Set(Object.values(THEME_PREVIEWS).map((p) => JSON.stringify(p)));
    expect(canvases.size).toBe(APP_THEME_IDS.length);
  });
});
