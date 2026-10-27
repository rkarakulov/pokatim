import { defaultShape } from '@rkarakulov/design-tokens';
import { describe, expect, it } from 'vitest';

import { appThemes, appThemeScheme, DEFAULT_THEME, type AppThemeDefinition } from './app-themes.ts';
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
