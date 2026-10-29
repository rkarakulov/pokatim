import { z } from 'zod';

import { PageQuery, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import { ActionReason } from './members.schema.ts';

/*
 * Сбои удаления аккаунтов в панели «Протокол» (erasure-failures, F13; право `platform.stats` — только admin): удаления,
 * чья фоновая очистка не завершилась за сутки (та же выборка, что карточка «Обзора»), и «Повторить удаление». Без ПДн
 * удалённого: только id, время, шаг, код ошибки и счётчик попыток.
 */

/** Шаги фоновой очистки по порядку (`AccountErasureService`, ADR-0015). Новый шаг — в конец, до `identity` по смыслу. */
export const ERASURE_STEPS = [
  'profile',
  'rides',
  'routes',
  'ride-starts',
  'devices',
  'tracks',
  'route-rides',
  'achievements',
  'tickets',
  'notifications',
  'identity',
] as const;
export const ErasureStep = z.enum(ERASURE_STEPS);
export type ErasureStep = z.infer<typeof ErasureStep>;

export const ACCOUNT_ERASURES_MAX_LIMIT = 50;

/** `GET /v1/admin/account-erasures?cursor&limit` → `AccountErasurePage`: самые давние удаления первыми. */
export const AccountErasureQuery = z.strictObject({
  ...PageQuery.shape,
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(ACCOUNT_ERASURES_MAX_LIMIT).default(20),
});
export type AccountErasureQuery = z.infer<typeof AccountErasureQuery>;

/** Последний провал шага: `code` — безопасный токен (`ECONNECTION`, `11000`, `MongoServerError`…), не текст ошибки. */
export const AccountErasureFailure = z.object({
  step: ErasureStep,
  code: z.string(),
  at: z.iso.datetime(),
});
export type AccountErasureFailure = z.infer<typeof AccountErasureFailure>;

/**
 * Незавершённое удаление. `lastFailure: null` — провалов не записано (worker не дошёл до задачи или сбой до первого
 * шага); `retryRequestedAt` — последний повтор из панели.
 */
export const AccountErasureRow = z.object({
  userId: Uuid,
  deletedAt: z.iso.datetime(),
  failedAttempts: z.number().int().nonnegative(),
  lastFailure: AccountErasureFailure.nullable(),
  retryRequestedAt: z.iso.datetime().nullable(),
});
export type AccountErasureRow = z.infer<typeof AccountErasureRow>;

export const AccountErasurePage = z.object({
  items: z.array(AccountErasureRow),
  nextCursor: z.string().nullable(),
});
export type AccountErasurePage = z.infer<typeof AccountErasurePage>;

/** `POST /v1/admin/account-erasures/:userId/retry` — повтор очистки, причина — в журнал (`account.erasure_retried`). */
export const RetryAccountErasureRequest = z.strictObject({ reason: ActionReason });
export type RetryAccountErasureRequest = z.infer<typeof RetryAccountErasureRequest>;

/**
 * `queued: false` — повтор уже запрошен недавно и после него сбоев не было (идемпотентный успех без журнала). Нет
 * удалённого аккаунта — 404; очистка завершена или ещё не зависла — 409 `CONFLICT`.
 */
export const RetryAccountErasureResult = z.object({ queued: z.boolean() });
export type RetryAccountErasureResult = z.infer<typeof RetryAccountErasureResult>;
