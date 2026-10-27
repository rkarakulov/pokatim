import { defaultShape, radius, space } from '@rkarakulov/design-tokens';
import { describe, expect, it } from 'vitest';

import {
  appDensity,
  appThemes,
  appThemeScheme,
  DEFAULT_THEME,
  type AppThemeDefinition,
  type AppThemeId,
} from './app-themes.ts';
import { themes } from './brand.ts';

/** Ключи групп ролей схемы (`text.primary`, `map.basemap`, `shape.button`, …) — «форма» темы. */
const shapeKeys = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, nested]) => shapeKeys(nested, `${prefix}${key}.`))
    : [prefix.slice(0, -1)];

const definitions = Object.values(appThemes);

describe('реестр тем приложения', () => {
  it('7 тем в порядке APP_THEME_IDS, id совпадает с ключом', () => {
    expect(Object.keys(appThemes)).toEqual([
      'classic',
      'atlas',
      'chrono',
      'planner',
      'journal',
      'navigation',
      'typography',
    ]);
    for (const [key, def] of Object.entries(appThemes)) expect(def.id).toBe(key);
  });

  it('все схемы всех тем — одной формы (ключи ролей, групп pokatim и формы)', () => {
    const reference = shapeKeys(appThemes.classic.schemes.light).sort();
    for (const def of definitions) {
      for (const scheme of [def.schemes.light, def.schemes.dark]) {
        expect(shapeKeys(scheme).sort()).toEqual(reference);
      }
    }
  });

  it('«Классика» — нынешние light/dark (те же объекты), по системе', () => {
    expect(appThemes.classic.schemes.light).toBe(themes.light);
    expect(appThemes.classic.schemes.dark).toBe(themes.dark);
    expect(appThemes.classic.colorScheme).toBe('system');
    expect(DEFAULT_THEME).toBe(appThemes.classic);
  });

  it('«Классика»: форма базы, подложка по схеме, профиль — прежние цвета коридора и сетки', () => {
    const { light, dark } = appThemes.classic.schemes;
    expect(light.shape).toBe(defaultShape);
    expect(dark.shape).toBe(defaultShape);
    expect(light.map.basemap).toBe('light');
    expect(dark.map.basemap).toBe('dark');
    expect(light.profile).toEqual({
      line: light.map.corridor,
      fillTop: light.map.corridor,
      fillBottom: light.map.corridor,
      grid: light.border.subtle,
    });
    expect(dark.profile).toEqual({
      line: dark.map.corridor,
      fillTop: dark.map.corridor,
      fillBottom: dark.map.corridor,
      grid: dark.border.subtle,
    });
  });

  it('у тем «всегда тёмная» светлая и тёмная схемы совпадают', () => {
    for (const def of definitions.filter((d) => d.colorScheme === 'dark')) {
      expect(def.schemes.light).toBe(def.schemes.dark);
    }
  });

  it('appThemeScheme: system — по системе, dark — всегда тёмная', () => {
    const darkOnly: AppThemeDefinition = { ...appThemes.classic, colorScheme: 'dark' };
    expect(appThemeScheme(appThemes.classic, 'light')).toBe('light');
    expect(appThemeScheme(appThemes.classic, 'dark')).toBe('dark');
    expect(appThemeScheme(darkOnly, 'light')).toBe('dark');
    expect(appThemeScheme(darkOnly, 'dark')).toBe('dark');
  });
});

type NewThemeId = Exclude<AppThemeId, 'classic'>;

/** 7.5 плана C: радиусы (button / field / chip / card / sheet), регистр, плотность, иконки. */
const FORM: Record<
  NewThemeId,
  {
    shape: [number, number, number, number, number, 'upper' | 'none'];
    density: 'regular' | 'comfortable';
    icons: { weight: 'regular' | 'semibold'; filled: boolean };
  }
> = {
  atlas: {
    shape: [14, 12, radius.pill, 16, 24, 'none'],
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
  },
  chrono: {
    shape: [12, 10, radius.pill, 12, 20, 'none'],
    density: 'regular',
    icons: { weight: 'semibold', filled: true },
  },
  planner: {
    shape: [radius.pill, 12, radius.pill, 14, 24, 'none'],
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
  },
  journal: {
    shape: [12, 10, radius.pill, 14, 20, 'none'],
    density: 'comfortable',
    icons: { weight: 'regular', filled: false },
  },
  navigation: {
    shape: [radius.pill, 12, radius.pill, 16, 24, 'none'],
    density: 'regular',
    icons: { weight: 'semibold', filled: true },
  },
  typography: {
    shape: [8, 4, 4, 0, 16, 'upper'],
    density: 'regular',
    icons: { weight: 'semibold', filled: false },
  },
};

/** 7.4 плана C: гарнитуры ролей. */
const FONTS: Record<NewThemeId, [string, string]> = {
  atlas: ['Manrope', 'Manrope'],
  chrono: ['Roboto Condensed', 'Inter'],
  planner: ['Onest', 'Onest'],
  journal: ['Golos Text', 'Golos Text'],
  navigation: ['Inter Tight', 'Inter'],
  typography: ['Oswald', 'Inter'],
};

const newThemes = (Object.keys(FORM) as NewThemeId[]).map((id) => appThemes[id]);

describe('шесть тем слайса C', () => {
  it('Хронометр и Навигация — всегда тёмные (одна схема), остальные — по системе', () => {
    const darkOnly = definitions.filter((d) => d.colorScheme === 'dark').map((d) => d.id);
    expect(darkOnly).toEqual(['chrono', 'navigation']);
    expect(appThemes.chrono.schemes.light).toBe(appThemes.chrono.schemes.dark);
    expect(appThemes.navigation.schemes.light).toBe(appThemes.navigation.schemes.dark);
  });

  it('у каждой темы своя палитра: схемы новых тем не совпадают с «Классикой» и между собой', () => {
    const schemes = new Set(definitions.flatMap((d) => [d.schemes.light, d.schemes.dark]));
    // 7 тем: 5 пар по системе + 2 одиночные тёмные
    expect(schemes.size).toBe(12);
    for (const def of newThemes) {
      expect(def.schemes.light).not.toEqual(themes.light);
      expect(def.schemes.dark).not.toEqual(themes.dark);
    }
  });

  it('палитры — по 7.1: опорные роли', () => {
    expect(appThemes.atlas.schemes.light.text.accent).toBe('#C2410C');
    expect(appThemes.atlas.schemes.light.surface.default).toBe('#F2F3F5');
    expect(appThemes.chrono.schemes.dark.action).toEqual({
      primary: '#FF6A1A',
      onPrimary: '#0B0B0C',
    });
    expect(appThemes.chrono.schemes.dark.tabBar.active).toBe('#FF6A1A');
    expect(appThemes.planner.schemes.light.map.route).toBe('#141412');
    expect(appThemes.journal.schemes.light.action.primary).toBe('#22702A');
    expect(appThemes.navigation.schemes.dark.map.route).toBe('#5BA8FF');
    expect(appThemes.typography.schemes.light.action).toEqual({
      primary: '#FF5A1F',
      onPrimary: '#0D0D0D',
    });
    expect(appThemes.typography.schemes.dark.text.accent).toBe('#FF7A45');
  });

  it('структурные правила схемы (7.1) у всех новых тем', () => {
    for (const def of newThemes) {
      for (const s of [def.schemes.light, def.schemes.dark]) {
        expect(s.text.placeholder).toBe(s.text.secondary);
        expect(s.text.onPhoto).toBe('#FFFFFF');
        expect(s.text.onPrimary).toBe(s.action.onPrimary);
        expect(s.surface.sheet).toBe(s.surface.raised);
        expect(s.surfaceBar).toEqual({
          asphalt: s.text.primary,
          gravel: s.border.subtle,
          gravelHatch: s.text.primary,
          outline: s.text.secondary,
        });
        expect(s.profile.fillBottom).toBe(s.profile.fillTop);
        expect(s.profile.grid).toBe(s.border.subtle);
        expect(s.control.track).toBe(s.border.input);
        expect(s.control.thumb).toBe('#FFFFFF');
        expect(s.overlay.scrim).toBe('#000000');
        expect(s.tabBar.inactive).toBe(s.text.secondary);
      }
    }
  });

  it('подложка карты: светлая схема — light, тёмная — dark; Хронометр и Навигация — dark', () => {
    for (const def of newThemes) {
      const expected = def.colorScheme === 'dark' ? 'dark' : 'light';
      expect(def.schemes.light.map.basemap).toBe(expected);
      expect(def.schemes.dark.map.basemap).toBe('dark');
    }
  });

  it.each(Object.entries(FORM))('%s: форма, плотность, иконки — по 7.5', (id, form) => {
    const def = appThemes[id as NewThemeId];
    const [button, field, chip, card, sheet, buttonCase] = form.shape;
    expect(def.schemes.light.shape).toEqual({ button, field, chip, card, sheet, buttonCase });
    expect(def.schemes.dark.shape).toBe(def.schemes.light.shape);
    expect(def.density).toBe(form.density);
    expect(def.icons).toEqual(form.icons);
  });

  it.each(Object.entries(FONTS))('%s: гарнитуры display/text и CSS-стек', (id, [display, text]) => {
    const def = appThemes[id as NewThemeId];
    expect(def.fonts.display).toBe(display);
    expect(def.fonts.text).toBe(text);
    expect(def.fonts.stack.display.replaceAll("'", '').startsWith(`${display},`)).toBe(true);
    expect(def.fonts.stack.text).toContain(text);
  });

  it('сжатые гарнитуры — со сжатыми фолбэками', () => {
    expect(appThemes.chrono.fonts.stack.display).toBe(
      "'Roboto Condensed', 'Arial Narrow', Arial, sans-serif",
    );
    expect(appThemes.typography.fonts.stack.display).toBe(
      "Oswald, 'Arial Narrow', Impact, sans-serif",
    );
    expect(appThemes.chrono.fonts.stack.text).toBe(appThemes.classic.fonts.stack.text);
  });
});

describe('плотность (appDensity)', () => {
  it('regular — нынешний отступ без зазора; comfortable — крупнее и с зазором', () => {
    expect(appDensity.regular).toEqual({ cardPadding: space.s4, listGap: 0 });
    expect(appDensity.comfortable).toEqual({ cardPadding: space.s5, listGap: space.s3 });
  });
});

describe('«Классика»: группа tabBar = прежние роли вкладок', () => {
  it.each(['light', 'dark'] as const)('%s', (scheme) => {
    const s = appThemes.classic.schemes[scheme];
    expect(s.tabBar).toEqual({
      background: s.surface.default,
      active: s.text.primary,
      inactive: s.text.secondary,
    });
  });
});
