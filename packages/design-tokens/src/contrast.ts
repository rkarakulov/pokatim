import {
  contrastPair,
  contrastPairs as baseContrastPairs,
  WCAG,
  type ContrastPair,
  type Theme,
} from '@rkarakulov/design-tokens';

import { themes, type PokatimRoleGroups, type ThemeName } from './brand.ts';

export { contrastRatio, WCAG, type ContrastPair } from '@rkarakulov/design-tokens';

/**
 * Пары, которые реально встречаются в компонентах схемы (любой темы приложения или набора `themes`). Свои группы
 * ролей бренда добавляйте парами `contrastPair('group.role / group.background', …)` из базы — их проверит тот же тест.
 */
export function contrastPairsOf(t: Theme<PokatimRoleGroups>): ContrastPair[] {
  return [
    ...baseContrastPairs(t),
    // карта маршрута pokatim
    contrastPair('map.route / map.background', t.map.route, t.map.background, WCAG.ui),
    contrastPair('map.corridor / map.background', t.map.corridor, t.map.background, WCAG.ui),
    contrastPair('map.track / map.background', t.map.track, t.map.background, WCAG.ui),
    contrastPair('map.offCorridor / map.background', t.map.offCorridor, t.map.background, WCAG.ui),
    // профиль высоты на экране маршрута
    contrastPair('profile.line / surface.default', t.profile.line, t.surface.default, WCAG.ui),
    // профиль высоты в шторке карточки маршрута
    contrastPair('profile.line / surface.sheet', t.profile.line, t.surface.sheet, WCAG.ui),
    // акцент на карточках вариантов раскладки (плитки, герой)
    contrastPair('text.accent / surface.raised', t.text.accent, t.surface.raised, WCAG.text),
    // подписи вкладок — текст
    contrastPair(
      'tabBar.active / tabBar.background',
      t.tabBar.active,
      t.tabBar.background,
      WCAG.text,
    ),
    contrastPair(
      'tabBar.inactive / tabBar.background',
      t.tabBar.inactive,
      t.tabBar.background,
      WCAG.text,
    ),
  ];
}

/** Пары темы набора `themes` (в т. ч. `panel`). */
export function contrastPairs(themeName: ThemeName): ContrastPair[] {
  return contrastPairsOf(themes[themeName]);
}
