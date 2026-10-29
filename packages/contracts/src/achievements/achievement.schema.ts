import { z } from 'zod';

import { fieldError, tolerantEnum, Uuid } from '../common.ts';
import { LocalDate } from '../time.ts';

/**
 * Каталог достижений v1 (achievements, A1): каждое — один раз на райдера, уровней нет. Коды — только в конец
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
] as const;
/** Код достижения — строгий (запросы). */
export const AchievementCode = z.enum(ACHIEVEMENT_CODES);
export type AchievementCode = z.infer<typeof AchievementCode>;

/** Вид объекта достижения: гонка, маршрут, кофе-райд (только в конец). */
export const ACHIEVEMENT_OBJECT_KINDS = ['race', 'route', 'ride'] as const;
export type AchievementObjectKind = (typeof ACHIEVEMENT_OBJECT_KINDS)[number];

/** Объект достижения: гонка, маршрут или райд, на котором выполнено условие; название — текущее. */
export const AchievementObject = z.object({
  kind: tolerantEnum(ACHIEVEMENT_OBJECT_KINDS),
  id: Uuid,
  title: z.string(),
});
export type AchievementObject = z.infer<typeof AchievementObject>;

const AchievementFields = {
  code: tolerantEnum(ACHIEVEMENT_CODES),
  object: AchievementObject,
  /** день факта по Минску — без времени суток (RC-7) */
  factDate: LocalDate,
};

/** Своё достижение (`GET /v1/achievements`): `seen: false` — ещё не показано вспышкой. */
export const Achievement = z.object({ ...AchievementFields, seen: z.boolean() });
export type Achievement = z.infer<typeof Achievement>;

/** Свои достижения: от новых фактов к старым (порядок массива — порядок сервера). */
export const AchievementList = z.object({ items: z.array(Achievement) });
export type AchievementList = z.infer<typeof AchievementList>;

/** Публичное достижение (`GET /v1/riders/:publicId/achievements`): только гоночные, без `seen`. */
export const PublicRiderAchievement = z.object(AchievementFields);
export type PublicRiderAchievement = z.infer<typeof PublicRiderAchievement>;

export const PublicRiderAchievementList = z.object({ items: z.array(PublicRiderAchievement) });
export type PublicRiderAchievementList = z.infer<typeof PublicRiderAchievementList>;

/** `POST /v1/achievements/seen` — показанные коды: 1–9, без повторов (иначе 400 `VALIDATION_FAILED`). */
export const MarkAchievementsSeenRequest = z.strictObject({
  codes: z
    .array(AchievementCode)
    .min(1)
    .max(ACHIEVEMENT_CODES.length)
    .refine((codes) => new Set(codes).size === codes.length, { error: fieldError('INVALID') }),
});
export type MarkAchievementsSeenRequest = z.infer<typeof MarkAchievementsSeenRequest>;
