import type { Theme as BaseTheme } from '@rkarakulov/design-tokens';

import type { PokatimRoleGroups } from './brand.ts';

/**
 * Дизайн-система проекта поверх базы `@rkarakulov/design-tokens`: бренд (`brand.ts`) + структурные токены
 * базы. Приложения используют темы, типографику и размеры; палитра — только внутри `brand.ts`.
 * Реэкспорт базы — только явный: у базы `contrastPairs`/`designSystemCss` с другими сигнатурами.
 */
export {
  autofillCss,
  defaultShape,
  density,
  fontWeights,
  inset,
  motion,
  radius,
  shapeOf,
  size,
  space,
  stroke,
  typography,
  type ColorRoles,
  type FontFace,
  type FontRole,
  type FontWeight,
  type NavRoles,
  type ShapeRoles,
  type TextStyleName,
  type TextStyleToken,
} from '@rkarakulov/design-tokens';
export {
  font,
  fontStack,
  themes,
  type AppTheme,
  type Basemap,
  type PokatimRoleGroups,
  type ThemeName,
} from './brand.ts';
export {
  appThemes,
  appThemeScheme,
  DEFAULT_THEME,
  type AppColorScheme,
  type AppDensity,
  type AppThemeDefinition,
  type AppThemeFonts,
  type AppThemeId,
  type AppThemeLayout,
  type IconWeight,
} from './app-themes.ts';
export {
  contrastPairs,
  contrastPairsOf,
  contrastRatio,
  WCAG,
  type ContrastPair,
} from './contrast.ts';
export { designSystemCss, skeletonCss, typographyCss, type DesignSystemCssOptions } from './css.ts';

/**
 * Раскладка приложения райдера (px): колонка контента на широком экране (web на десктопе, планшет) — не шире
 * `contentMaxWidth`, по центру; на телефоне ограничение не срабатывает. В базе (`size`) готового значения нет.
 */
export const layout = { contentMaxWidth: 640 } as const;

/** Любая тема набора (у `panel` есть навигация); группы ролей pokatim — `map`, `surfaceBar`, `profile`. */
export type Theme = BaseTheme<PokatimRoleGroups>;
