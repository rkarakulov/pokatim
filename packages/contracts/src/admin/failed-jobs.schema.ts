import { z } from 'zod';

import { fieldError, Uuid } from '../common.ts';
import { ActionReason } from './members.schema.ts';

/*
 * «Упавшие задачи» панели «Протокол» (admin-failed-jobs; право `platform.stats` — только admin): финальные провалы
 * задач BullMQ по всем очередям и события outbox, не опубликованные дольше `OUTBOX_STUCK_MINUTES`. Схемы панели —
 * строгие (панель деплоится вместе с API). Данные задачи (`data`) наружу не выходят.
 */

export const FAILED_JOBS_MAX_LIMIT = 100;
export const OUTBOX_STUCK_MINUTES = 10;
export const OUTBOX_STUCK_ITEMS_MAX = 20;
/** Предел текста ошибки в ответе: первая строка `failedReason`, e-mail заменены. */
export const FAILED_JOB_ERROR_MAX = 300;

/** Имя очереди (`queues.ts` API, kebab-case); незнакомое сервер отклоняет `404`. */
export const QueueName = z
  .string({ error: fieldError('REQUIRED') })
  .regex(/^[a-z0-9-]{1,64}$/, { error: 'INVALID' });
export type QueueName = z.infer<typeof QueueName>;

/** Id задачи BullMQ: id события outbox, `push-<uid>-<ms>`, `fanout-…`, `story-card-<hash>` и т. п. */
export const FailedJobId = z
  .string({ error: fieldError('REQUIRED') })
  .regex(/^[A-Za-z0-9._:-]{1,200}$/, { error: 'INVALID' });
export type FailedJobId = z.infer<typeof FailedJobId>;

/** `GET /v1/admin/failed-jobs?queue&limit` → `FailedJobsView`: без `queue` — все очереди, новые провалы сверху. */
export const FailedJobsQuery = z.strictObject({
  queue: QueueName.optional(),
  limit: z.coerce.number().int().min(1).max(FAILED_JOBS_MAX_LIMIT).default(50),
});
export type FailedJobsQuery = z.infer<typeof FailedJobsQuery>;

/** Финально упавшая задача: `attempts` — предел попыток задачи (`null` — без своего предела). */
export const FailedJobRow = z.object({
  queue: z.string(),
  jobId: z.string(),
  name: z.string(),
  attemptsMade: z.number().int().nonnegative(),
  attempts: z.number().int().positive().nullable(),
  error: z.string().max(FAILED_JOB_ERROR_MAX).nullable(),
  createdAt: z.iso.datetime(),
  failedAt: z.iso.datetime().nullable(),
  /** id события outbox, если задачу поставил публикатор outbox */
  outboxEventId: Uuid.nullable(),
});
export type FailedJobRow = z.infer<typeof FailedJobRow>;

export const FailedJobQueueCount = z.object({
  queue: z.string(),
  failed: z.number().int().nonnegative(),
});
export type FailedJobQueueCount = z.infer<typeof FailedJobQueueCount>;

/** Событие outbox без публикации дольше `OUTBOX_STUCK_MINUTES` (публикатор не работает или очередь недоступна). */
export const StuckOutboxEvent = z.object({
  id: Uuid,
  type: z.string(),
  createdAt: z.iso.datetime(),
});
export type StuckOutboxEvent = z.infer<typeof StuckOutboxEvent>;

export const FailedJobsView = z.object({
  /** все очереди API в порядке `queues.ts`, с нулями */
  queues: z.array(FailedJobQueueCount),
  items: z.array(FailedJobRow).max(FAILED_JOBS_MAX_LIMIT),
  outbox: z.object({
    /** точное число, не больше предела подсчёта сервера */
    stuck: z.number().int().nonnegative(),
    oldestAt: z.iso.datetime().nullable(),
    items: z.array(StuckOutboxEvent).max(OUTBOX_STUCK_ITEMS_MAX),
  }),
});
export type FailedJobsView = z.infer<typeof FailedJobsView>;

/**
 * `POST /v1/admin/failed-jobs/:queue/:jobId/retry` и `…/delete` — причина в журнал (`jobs.failed_retried` /
 * `jobs.failed_removed`). Нет очереди или задачи — `404`; задача уже не в failed — `409 CONFLICT`. Ответ — `204`.
 */
export const FailedJobActionRequest = z.strictObject({ reason: ActionReason });
export type FailedJobActionRequest = z.infer<typeof FailedJobActionRequest>;
