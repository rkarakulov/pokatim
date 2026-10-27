import { APP_THEME_IDS } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { describe, expect, it } from 'vitest';

import { previewOf, THEME_PREVIEWS } from './theme-previews';

describe('превью тем в панели (app-themes C1, AC8)', () => {
  it('ключи — APP_THEME_IDS в том же порядке, у каждой темы — цветное превью', () => {
    expect(Object.keys(THEME_PREVIEWS)).toEqual([...APP_THEME_IDS]);
    for (const id of APP_THEME_IDS) expect(THEME_PREVIEWS[id]).toEqual(previewOf(appThemes[id]));
  });

  it('превью — роли светлой схемы темы из реестра (у «всегда тёмных» — их единственная)', () => {
    for (const def of Object.values(appThemes)) {
      const scheme = def.schemes.light;
      expect(previewOf(def)).toEqual({
        canvas: scheme.surface.default,
        card: scheme.surface.raised,
        text: scheme.text.primary,
        accent: scheme.action.primary,
        route: scheme.map.route,
        radius: scheme.shape.card,
        font: def.fonts.display,
      });
    }
    expect(THEME_PREVIEWS.chrono.canvas).toBe(appThemes.chrono.schemes.dark.surface.default);
  });

  it('у тем разные превью', () => {
    const canvases = new Set(Object.values(THEME_PREVIEWS).map((p) => JSON.stringify(p)));
    expect(canvases.size).toBe(APP_THEME_IDS.length);
  });
});
