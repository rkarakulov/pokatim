import { z } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_ACTIVITY_READY, TRACK_ACTIVITY_REMOVED } from '../tracks';

/** Заявка создана — подхватить заезды райдера, уже лежащие в окне гонки («проехал и забыл», Q3). */
export const RESULTS_ENTRY_CREATED = 'results.entry-created';
export const ResultsEntryCreated = z.object({ entryId: z.uuid() });
export type ResultsEntryCreated = z.infer<typeof ResultsEntryCreated>;

/** Попытка поставлена на проверку (новая ревизия). jobId задачи = id события. */
export const RESULTS_ATTEMPT_CHECK_REQUESTED = 'results.attempt-check-requested';
export const ResultsAttemptCheckRequested = z.object({
  attemptId: z.uuid(),
  checkRevision: z.number().int().nonnegative(),
});
export type ResultsAttemptCheckRequested = z.infer<typeof ResultsAttemptCheckRequested>;

/**
 * Маршруты событий для очередей `results` (подключает worker.module.ts): свои события и подписка на события
 * `tracks` (тип события → одна очередь: у подписчика — свои типы, `tracks.upload-deleted` слушает `devices`).
 */
export const resultsOutboxRoutes = {
  [TRACK_ACTIVITY_READY]: QUEUE.resultsIntake,
  [TRACK_ACTIVITY_REMOVED]: QUEUE.resultsIntake,
  [RESULTS_ENTRY_CREATED]: QUEUE.resultsIntake,
  [RESULTS_ATTEMPT_CHECK_REQUESTED]: QUEUE.attemptCheck,
} as const;
