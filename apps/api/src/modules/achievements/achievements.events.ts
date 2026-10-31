import { z } from 'zod';

/*
 * События достижений (achievements-push, ADR-0017/ADR-0020): пишутся в транзакции с выдачей, которая вспыхнула бы
 * (P1); потребитель — `notifications`, маршрут объявляет он (`notificationsOutboxRoutes`). Payload — только id и коды:
 * без `userId`, названий и текстов (ADR-0017 п. 2); получателя и объект отдаёт порт `ACHIEVEMENT_NOTICES`.
 */

/** Источник сверки: `read` — `GET /v1/achievements` (райдер в приложении, только центр), `server` — серверная сверка. */
export const ACHIEVEMENT_RECONCILE_ORIGINS = ['read', 'server'] as const;
export type ReconcileOrigin = (typeof ACHIEVEMENT_RECONCILE_ORIGINS)[number];

/** Новая выдача (несезонная или сезонная) или новый уровень несезонной. */
export const ACHIEVEMENTS_GRANT_NOTICED = 'achievements.grant-noticed';
export const AchievementsGrantNoticed = z.object({
  grant: z.enum(['fact', 'season']),
  grantId: z.uuid(),
  /** объявленный ранг счётного; разовые и сезонные — `null` */
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  origin: z.enum(ACHIEVEMENT_RECONCILE_ORIGINS),
});
export type AchievementsGrantNoticed = z.infer<typeof AchievementsGrantNoticed>;
