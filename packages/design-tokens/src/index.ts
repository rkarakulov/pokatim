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
  appDensity,
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
export {
  APP_FONT_FILE_IDS,
  appFontFaces,
  fontFilesOf,
  type FontFileId,
  type RoleFontFiles,
} from './app-fonts.ts';
export {
  STORY_CARD_TIME_STEPS,
  storyCard,
  storyCardColors,
  type StoryCardColors,
  type StoryCardText,
} from './story-card.ts';
export { designSystemCss, skeletonCss, typographyCss, type DesignSystemCssOptions } from './css.ts';

/**
 * Раскладка приложения райдера (px): колонка контента на широком экране (web на десктопе, планшет) — не шире
 * `contentMaxWidth`, по центру; на телефоне ограничение не срабатывает. `avatarProfile` — аватар шапки профиля
 * (`.phead-name .ava` прототипа, rider-profile). В базе (`size`) готовых значений нет; follow-up — `size.avatarLg` в
 * app-foundation. `badgeGrid` / `badgeHero` — значок достижения «Эмаль» в сетке блока профиля и крупно на вспышке
 * (achievements); follow-up — `size.badge*` в app-foundation.
 */
export const layout = {
  contentMaxWidth: 640,
  avatarProfile: 56,
  badgeGrid: 72,
  badgeHero: 152,
} as const;

/**
 * Пропорции значка «Эмаль» (доли диаметра, achievements): отступ и толщина кольца акцента, диск основного действия,
 * иконка в диске. Px — из диаметра (`layout.badgeGrid` / `layout.badgeHero`), отдельных литералов нет.
 */
export const badgeShape = { ringInset: 0.07, ringWidth: 0.1, disc: 0.56, icon: 0.28 } as const;

/** Любая тема набора (у `panel` есть навигация); группы ролей pokatim — `map`, `surfaceBar`, `profile`, `tabBar`. */
export type Theme = BaseTheme<PokatimRoleGroups>;
