import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { fieldError, Uuid } from '../common.ts';
import { LocalDate } from '../time.ts';
import {
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_OBJECT_KINDS,
  AchievementCode,
  isLeveledCode,
  isSeasonalCode,
} from './achievement.schema.ts';

/*
 * Достижения райдера в панели «Протокол» (achievements-panel, право `achievements.manage` — только admin): все выдачи
 * райдера со статусом, ручная выдача, ручной отзыв и снятие ручного решения («Вернуть автоматике») — с причиной в
 * журнале. Панель выкатывается одним деплоем с API — строгие enum-ы.
 */

/**
 * `POST /v1/admin/rider-achievements/:userId/grant` → 204. Вид объекта сервер выводит из кода
 * (`ACHIEVEMENT_OBJECT_KIND_BY_CODE`); `level` — только у счётного кода (по умолчанию бронза), у разового и сезонного —
 * 400 на поле `level`.
 */
export const GrantRiderAchievementRequest = z
  .strictObject({
    code: AchievementCode,
    objectId: Uuid,
    level: z.enum(ACHIEVEMENT_LEVELS).optional(),
    reason: ActionReason,
  })
  .refine((body) => body.level === undefined || isLeveledCode(body.code), {
    error: fieldError('INVALID'),
    path: ['level'],
  });
export type GrantRiderAchievementRequest = z.infer<typeof GrantRiderAchievementRequest>;

/** Адрес выдачи: несезонная — код; сезонная — код и сезон (`seasonId` ⇔ сезонный код). */
const OverrideTarget = z
  .strictObject({ code: AchievementCode, seasonId: Uuid.optional(), reason: ActionReason })
  .superRefine((body, ctx) => {
    const seasonal = isSeasonalCode(body.code);
    if (seasonal && body.seasonId === undefined)
      ctx.addIssue({ code: 'custom', message: 'REQUIRED', path: ['seasonId'] });
    if (!seasonal && body.seasonId !== undefined)
      ctx.addIssue({ code: 'custom', message: 'INVALID', path: ['seasonId'] });
  });

/** `POST /v1/admin/rider-achievements/:userId/revoke` → 204: отзыв видимой выдачи (фактовой или ручной). */
export const RevokeRiderAchievementRequest = OverrideTarget;
export type RevokeRiderAchievementRequest = z.infer<typeof RevokeRiderAchievementRequest>;

/** `POST /v1/admin/rider-achievements/:userId/clear` → 200 `ClearRiderAchievementOverrideResult`. */
export const ClearRiderAchievementOverrideRequest = OverrideTarget;
export type ClearRiderAchievementOverrideRequest = z.infer<
  typeof ClearRiderAchievementOverrideRequest
>;

/**
 * Итог снятия: `cleared: false` — ручного решения уже не было (без журнала); `reconciled` — немедленная сверка по фактам
 * выполнена (нет — досверит следующий вход райдера).
 */
export const ClearRiderAchievementOverrideResult = z.object({
  cleared: z.boolean(),
  reconciled: z.boolean(),
});
export type ClearRiderAchievementOverrideResult = z.infer<
  typeof ClearRiderAchievementOverrideResult
>;

/** Статус выдачи в панели: по документу (видимая = не отозвана, RC-12) и ручному решению. */
export const RIDER_ACHIEVEMENT_ADMIN_STATUSES = [
  'granted',
  'granted_manually',
  'revoked',
  'revoked_manually',
] as const;
export type RiderAchievementAdminStatus = (typeof RIDER_ACHIEVEMENT_ADMIN_STATUSES)[number];

export const ACHIEVEMENT_OVERRIDE_DECISIONS = ['granted', 'revoked'] as const;
export type AchievementOverrideDecision = (typeof ACHIEVEMENT_OVERRIDE_DECISIONS)[number];

/** «По фактам» (RC-6): заработано сейчас (с уровнем счётного), не заработано или неизвестно (сезон не итоговый, сбой). */
export const RIDER_ACHIEVEMENT_FACT_STATES = ['earned', 'not_earned', 'unknown'] as const;

/**
 * Выдача райдера в панели. `object.title` — текущее название (`null` — объект недоступен); `override` — ручное решение
 * с сотрудником; без e-mail и имени райдера, служебных полей показа и id выдачи.
 */
export const RiderAchievementAdminItem = z.object({
  code: AchievementCode,
  object: z.object({
    kind: z.enum(ACHIEVEMENT_OBJECT_KINDS),
    id: Uuid,
    title: z.string().nullable(),
  }),
  level: z.enum(ACHIEVEMENT_LEVELS).nullable(),
  /** день факта по Минску */
  factDate: LocalDate,
  status: z.enum(RIDER_ACHIEVEMENT_ADMIN_STATUSES),
  grantedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  override: z
    .object({
      decision: z.enum(ACHIEVEMENT_OVERRIDE_DECISIONS),
      at: z.iso.datetime(),
      by: z.object({ userId: Uuid, displayName: z.string() }),
    })
    .nullable(),
  byFacts: z.object({
    state: z.enum(RIDER_ACHIEVEMENT_FACT_STATES),
    level: z.enum(ACHIEVEMENT_LEVELS).nullable(),
  }),
});
export type RiderAchievementAdminItem = z.infer<typeof RiderAchievementAdminItem>;

/**
 * `GET /v1/admin/rider-achievements/:userId`: все выдачи (несезонные и сезонные, включая отозванные), от новых фактов к
 * старым; `seasonsAvailable: false` — итоги сезонов недоступны (названия сезонов `null`, «по фактам» — `unknown`).
 */
export const RiderAchievementsAdmin = z.object({
  items: z.array(RiderAchievementAdminItem),
  seasonsAvailable: z.boolean(),
});
export type RiderAchievementsAdmin = z.infer<typeof RiderAchievementsAdmin>;

/** `409 ACHIEVEMENT_INVALID_STATE`: видимая выдача уже есть (выдача) / видимой нет (отзыв). */
export const AchievementInvalidStateDetails = z.object({
  reason: z.enum(['already_granted', 'not_granted']),
});
export type AchievementInvalidStateDetails = z.infer<typeof AchievementInvalidStateDetails>;
