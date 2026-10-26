import { z } from 'zod';

import { Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import {
  ATTEMPT_FAILURES,
  ATTEMPT_ORIGINS,
  ATTEMPT_REJECTIONS,
  ATTEMPT_STATUSES,
  ATTEMPT_WITHDRAW_REASONS,
  AttemptSegment,
} from './results.schema.ts';

/*
 * Результаты гонки в панели (race-results-03, только чтение): строгие `z.enum` — панель деплоится с API. Без e-mail,
 * координат и биометрии.
 */

/** `GET /v1/admin/races/:raceId/results` (`races.read`) — сводка. */
export const PanelRaceResults = z.object({
  raceId: Uuid,
  lockedAt: z.iso.datetime().nullable(),
  /** текущая версия движка сверки */
  engineVersion: z.number().int(),
  counts: z.object({
    entries: z.number().int(),
    active: z.number().int(),
    withdrawn: z.number().int(),
    ranked: z.number().int(),
    attempts: z.record(z.enum(ATTEMPT_STATUSES), z.number().int()),
    hidden: z.number().int(),
    /** финальные провалы проверки (dead-letter) */
    failed: z.number().int(),
    /** проверены прежней версией движка */
    staleEngine: z.number().int(),
  }),
});
export type PanelRaceResults = z.infer<typeof PanelRaceResults>;

export const PanelRaceAttempt = z.object({
  id: Uuid,
  entryId: Uuid,
  userId: Uuid,
  activityId: Uuid,
  origin: z.enum(ATTEMPT_ORIGINS),
  status: z.enum(ATTEMPT_STATUSES),
  hidden: z.boolean(),
  reasons: z.array(z.enum(ATTEMPT_REJECTIONS)),
  failure: z.enum(ATTEMPT_FAILURES).nullable(),
  withdrawReason: z.enum(ATTEMPT_WITHDRAW_REASONS).nullable(),
  segment: AttemptSegment.nullable(),
  engineVersion: z.number().int().nullable(),
  checkRevision: z.number().int(),
  checkAttempts: z.number().int(),
  diagnostics: z
    .object({
      corridorLengthM: z.number().int(),
      declaredDistanceM: z.number().int(),
      geometryLimited: z.boolean(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
});
export type PanelRaceAttempt = z.infer<typeof PanelRaceAttempt>;

/** `GET /v1/admin/races/:raceId/attempts?status&cursor&limit` — новые сверху. */
export const PanelRaceAttemptQuery = z.strictObject({
  status: z.enum(ATTEMPT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: PageCursor.optional(),
});
export type PanelRaceAttemptQuery = z.infer<typeof PanelRaceAttemptQuery>;

export const PanelRaceAttemptPage = z.object({
  items: z.array(PanelRaceAttempt),
  nextCursor: z.string().nullable(),
});
export type PanelRaceAttemptPage = z.infer<typeof PanelRaceAttemptPage>;
