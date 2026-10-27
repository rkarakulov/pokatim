import { designSystemCss as baseDesignSystemCss, defineThemes } from '@rkarakulov/design-tokens';

import { fontStack, themes, type AppTheme, type ThemeName } from './brand.ts';

export { skeletonCss, typographyCss } from '@rkarakulov/design-tokens';

export interface DesignSystemCssOptions {
  theme: ThemeName;
  /** тема для `prefers-color-scheme: dark` */
  darkTheme?: ThemeName;
}

/**
 * Готовая таблица стилей для веба с брендом проекта: переменные темы + типографика + скелетон.
 * Плотность веб-панели (кнопки и строки таблиц 36 px, навигация 224 px) — часть темы `panel`.
 */
export function designSystemCss({ theme, darkTheme }: DesignSystemCssOptions): string {
  return baseDesignSystemCss({
    themes: cssThemes,
    theme,
    darkTheme,
    fontStack,
    dense: theme === 'panel',
  });
}

/** Подложка карты (`map.basemap`) — не цвет: `--color-map-basemap` в CSS не выводится. */
const withoutBasemap = (theme: AppTheme) => ({
  ...theme,
  map: Object.fromEntries(Object.entries(theme.map).filter(([role]) => role !== 'basemap')),
});
const cssThemes = defineThemes({
  light: withoutBasemap(themes.light),
  dark: withoutBasemap(themes.dark),
  panel: withoutBasemap(themes.panel),
});
