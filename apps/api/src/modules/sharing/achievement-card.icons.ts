import type { AchievementCode } from '@pokatim/contracts';

/** Значок кода на карточке: глиф Material Symbols и число на кольце («Пять гонок»). */
export interface AchievementBadgeIcon {
  /** кодовая точка глифа (`expo-symbols/build/android/symbols.json`) */
  glyph: number;
  count?: number;
}

const RACES = 0xf06e; // sports_score
const ROUTES = 0xe55b; // map
const RIDES = 0xe541; // local_cafe

/**
 * Зеркало иконок `ACHIEVEMENT_CATALOG` приложения (`features/achievements/achievement-catalog.ts`, имена Material —
 * `components/icon.tsx`): на Android и web `expo-symbols` рисует тот же шрифт по той же кодовой точке. Изменил
 * иконку кода в приложении — поменяй здесь и подними `STORY_CARD_POLICY.renderVersion`.
 */
export const ACHIEVEMENT_BADGE_ICONS = {
  race_first_finish: { glyph: RACES },
  race_podium: { glyph: 0xea3f }, // military_tech
  race_win: { glyph: 0xea23 }, // emoji_events
  races_5: { glyph: RACES, count: 5 },
  route_first: { glyph: ROUTES },
  routes_5: { glyph: ROUTES, count: 5 },
  ride_first: { glyph: RIDES },
  ride_organizer: { glyph: 0xe7fd }, // person
  rides_10: { glyph: RIDES, count: 10 },
} as const satisfies Record<AchievementCode, AchievementBadgeIcon>;
