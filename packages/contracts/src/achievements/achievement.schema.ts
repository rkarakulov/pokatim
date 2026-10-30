import { z } from 'zod';

import { fieldError, tolerantEnum, Uuid } from '../common.ts';
import { LocalDate } from '../time.ts';

/**
 * Каталог достижений (achievements, A1): каждое — один раз на райдера, сезонные — один раз на сезон
 * (`SEASONAL_ACHIEVEMENT_CODES`, S3); у счётных кодов — уровни (`ACHIEVEMENT_LEVEL_TARGETS`, L1). Коды — только в конец
 * (установленные сборки знают прежний состав; незнакомый код в ответе — `'unknown'`, RC-8).
 */
export const ACHIEVEMENT_CODES = [
  'race_first_finish',
  'race_podium',
  'race_win',
  'races_5',
  'route_first',
  'routes_5',
  'ride_first',
  'ride_organizer',
  'rides_10',
  'season_regular',
  'season_podium',
  'season_champion',
] as const;
/** Код достижения — строгий (запросы). */
export const AchievementCode = z.enum(ACHIEVEMENT_CODES);
export type AchievementCode = z.infer<typeof AchievementCode>;

/** Сезонные коды (S1): выдача — на сезон, объект — сезон; уровней нет. */
export const SEASONAL_ACHIEVEMENT_CODES = [
  'season_regular',
  'season_podium',
  'season_champion',
] as const satisfies readonly AchievementCode[];
export type SeasonalAchievementCode = (typeof SEASONAL_ACHIEVEMENT_CODES)[number];
export const isSeasonalCode = (code: AchievementCode): code is SeasonalAchievementCode =>
  (SEASONAL_ACHIEVEMENT_CODES as readonly string[]).includes(code);
/** «Сезон в зачёте» (S1): гонок с местом в одной таблице сезона. Выпущенное значение не меняется. */
export const SEASON_REGULAR_MIN_RACES = 3;

/** Вид объекта достижения: гонка, маршрут, кофе-райд, сезон (только в конец). */
export const ACHIEVEMENT_OBJECT_KINDS = ['race', 'route', 'ride', 'season'] as const;
export type AchievementObjectKind = (typeof ACHIEVEMENT_OBJECT_KINDS)[number];

/** Объект достижения: гонка, маршрут, райд или сезон, на котором выполнено условие; название — текущее. */
export const AchievementObject = z.object({
  kind: tolerantEnum(ACHIEVEMENT_OBJECT_KINDS),
  id: Uuid,
  title: z.string(),
});
export type AchievementObject = z.infer<typeof AchievementObject>;

/** Уровни счётных достижений (L1) — только в конец. */
export const ACHIEVEMENT_LEVELS = ['bronze', 'silver', 'gold'] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];

/**
 * Пороги уровней (L1): индекс = ранг − 1. Одна таблица на монорепо (политика API, карточка сторис, каталог приложения).
 * Выпущенные пороги не меняются; новый уровень — только в конец.
 */
export const ACHIEVEMENT_LEVEL_TARGETS = {
  races_5: [5, 15, 30],
  routes_5: [5, 15, 30],
  rides_10: [10, 25, 50],
} as const satisfies Partial<Record<AchievementCode, readonly [number, number, number]>>;
export type LeveledAchievementCode = keyof typeof ACHIEVEMENT_LEVEL_TARGETS;
export const isLeveledCode = (code: AchievementCode): code is LeveledAchievementCode =>
  code in ACHIEVEMENT_LEVEL_TARGETS;

const AchievementFields = {
  code: tolerantEnum(ACHIEVEMENT_CODES),
  object: AchievementObject,
  /** день факта по Минску — без времени суток (RC-7) */
  factDate: LocalDate,
  /** уровень счётного; разовые — `null`; старый API без поля — `null` (= v1, бронза у счётных) */
  level: tolerantEnum(ACHIEVEMENT_LEVELS).nullable().default(null),
};

/** Своё достижение (`GET /v1/achievements`): `seen: false` — ещё не показано вспышкой. */
export const Achievement = z.object({ ...AchievementFields, seen: z.boolean() });
export type Achievement = z.infer<typeof Achievement>;

/** Прогресс к следующему уровню счётного (L4) — только в своём списке; золото и счёт 0 — без строки. */
export const AchievementProgress = z.object({
  code: tolerantEnum(ACHIEVEMENT_CODES),
  level: tolerantEnum(ACHIEVEMENT_LEVELS),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
});
export type AchievementProgress = z.infer<typeof AchievementProgress>;

/**
 * Свои достижения: от новых фактов к старым (порядок массива — порядок сервера); `progress` — в порядке каталога
 * (старый API без поля — `[]`).
 */
export const AchievementList = z.object({
  items: z.array(Achievement),
  progress: z.array(AchievementProgress).default([]),
});
export type AchievementList = z.infer<typeof AchievementList>;

/**
 * Публичное достижение (`GET /v1/riders/:publicId/achievements`): только гоночные и сезонные, без `seen` и прогресса.
 */
export const PublicRiderAchievement = z.object(AchievementFields);
export type PublicRiderAchievement = z.infer<typeof PublicRiderAchievement>;

export const PublicRiderAchievementList = z.object({ items: z.array(PublicRiderAchievement) });
export type PublicRiderAchievementList = z.infer<typeof PublicRiderAchievementList>;

/** Адрес сезонной выдачи в `POST /v1/achievements/seen`. */
export const SeasonalAchievementRef = z.strictObject({
  code: z.enum(SEASONAL_ACHIEVEMENT_CODES),
  seasonId: Uuid,
});
export type SeasonalAchievementRef = z.infer<typeof SeasonalAchievementRef>;
/** Предел адресов `seasonal` в одном `POST seen`. */
export const SEASONAL_SEEN_MAX = 30;

/**
 * `POST /v1/achievements/seen`: `codes` — несезонные (сезонный код в `codes` — без записи, как незнакомый); `seasonal` —
 * сезонные по `(code, seasonId)`. Хотя бы один адрес, без повторов (иначе 400 `VALIDATION_FAILED`). Старые сборки шлют
 * `{ codes }` — валидно; клиент шлёт `seasonal` только непустым (старый API его не знает).
 */
export const MarkAchievementsSeenRequest = z
  .strictObject({
    codes: z
      .array(AchievementCode)
      .max(ACHIEVEMENT_CODES.length)
      .refine((codes) => new Set(codes).size === codes.length, { error: fieldError('INVALID') })
      .default([]),
    seasonal: z
      .array(SeasonalAchievementRef)
      .max(SEASONAL_SEEN_MAX)
      .refine(
        (refs) => new Set(refs.map((ref) => `${ref.code}:${ref.seasonId}`)).size === refs.length,
        { error: fieldError('INVALID') },
      )
      .default([]),
  })
  .refine((body) => body.codes.length + body.seasonal.length > 0, {
    error: fieldError('REQUIRED'),
    path: ['codes'],
  });
export type MarkAchievementsSeenRequest = z.infer<typeof MarkAchievementsSeenRequest>;
