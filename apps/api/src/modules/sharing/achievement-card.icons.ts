import {
  ACHIEVEMENT_LEVEL_TARGETS,
  ACHIEVEMENT_LEVELS,
  type AchievementCode,
  type AchievementLevel,
  isLeveledCode,
} from '@pokatim/contracts';

/** Значок кода на карточке: глиф Material Symbols и число на кольце (порог уровня счётного). */
export interface AchievementBadgeIcon {
  /** кодовая точка глифа (`expo-symbols/build/android/symbols.json`) */
  glyph: number;
  count?: number;
}

const RACES = 0xf06e; // sports_score
const ROUTES = 0xe55b; // map
const RIDES = 0xe541; // local_cafe
const PODIUM = 0xea3f; // military_tech
const TROPHY = 0xea23; // emoji_events

/**
 * Зеркало иконок `ACHIEVEMENT_CATALOG` приложения (`features/achievements/achievement-catalog.ts`, имена Material —
 * `components/icon.tsx`): на Android и web `expo-symbols` рисует тот же шрифт по той же кодовой точке. Изменил
 * иконку кода в приложении — поменяй здесь и подними `STORY_CARD_POLICY.renderVersion`. Пороги уровней (число на
 * значке) — не здесь: `ACHIEVEMENT_LEVEL_TARGETS` в контрактах. Сезонные — тот же каталог (`calendar`, `medal`,
 * `trophy`), без числа.
 */
export const ACHIEVEMENT_BADGE_ICONS = {
  race_first_finish: { glyph: RACES },
  race_podium: { glyph: PODIUM },
  race_win: { glyph: TROPHY },
  races_5: { glyph: RACES },
  route_first: { glyph: ROUTES },
  routes_5: { glyph: ROUTES },
  ride_first: { glyph: RIDES },
  ride_organizer: { glyph: 0xe7fd }, // person
  rides_10: { glyph: RIDES },
  season_regular: { glyph: 0xebcc }, // calendar_month
  season_podium: { glyph: PODIUM },
  season_champion: { glyph: TROPHY },
} as const satisfies Record<AchievementCode, Pick<AchievementBadgeIcon, 'glyph'>>;

/**
 * Число на значке (L6): порог текущего уровня счётного из `ACHIEVEMENT_LEVEL_TARGETS` (контракты — одна таблица с
 * приложением); у счётного без уровня (не бывает) — бронза; разовые — без числа.
 */
export function badgeCount(
  code: AchievementCode,
  level: AchievementLevel | null,
): number | undefined {
  if (!isLeveledCode(code)) return undefined;
  const rank = level === null ? 0 : ACHIEVEMENT_LEVELS.indexOf(level);
  return ACHIEVEMENT_LEVEL_TARGETS[code][rank];
}

/** Значок карточки: глиф кода и число уровня. */
export function achievementBadgeIcon(
  code: AchievementCode,
  level: AchievementLevel | null,
): AchievementBadgeIcon {
  const count = badgeCount(code, level);
  const glyph = ACHIEVEMENT_BADGE_ICONS[code].glyph;
  return count === undefined ? { glyph } : { glyph, count };
}
