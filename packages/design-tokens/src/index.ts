import type { Theme as BaseTheme, ThemeOf } from '@rkarakulov/design-tokens';

import type { PokatimRoleGroups, themes } from './brand.ts';

/**
 * Дизайн-система проекта поверх базы `@rkarakulov/design-tokens`: бренд (`brand.ts`) + структурные токены
 * базы. Приложения используют темы, типографику и размеры; палитра — только внутри `brand.ts`.
 * Реэкспорт базы — только явный: у базы `contrastPairs`/`designSystemCss` с другими сигнатурами.
 */
export {
  autofillCss,
  density,
  fontWeights,
  inset,
  motion,
  radius,
  size,
  space,
  stroke,
  typography,
  type ColorRoles,
  type FontFace,
  type FontRole,
  type FontWeight,
  type NavRoles,
  type TextStyleName,
  type TextStyleToken,
} from '@rkarakulov/design-tokens';
export { font, fontStack, themes, type PokatimRoleGroups, type ThemeName } from './brand.ts';
export { contrastPairs, contrastRatio, WCAG, type ContrastPair } from './contrast.ts';
export { designSystemCss, skeletonCss, typographyCss, type DesignSystemCssOptions } from './css.ts';

/**
 * Раскладка приложения райдера (px): колонка контента на широком экране (web на десктопе, планшет) — не шире
 * `contentMaxWidth`, по центру; на телефоне ограничение не срабатывает. В базе (`size`) готового значения нет.
 */
export const layout = { contentMaxWidth: 640 } as const;

/** Тема проекта для `useTheme<AppTheme>()`: роли базы (+ свои группы ролей бренда). */
export type AppTheme = ThemeOf<typeof themes>;
/** Любая тема набора (у `panel` есть навигация); группы ролей pokatim — `map`, `surfaceBar`. */
export type Theme = BaseTheme<PokatimRoleGroups>;
