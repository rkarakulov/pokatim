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
 * Запущена перепроверка треков гонки (race-results-05, RC-1): worker (`results-intake`) ставит на новую проверку
 * вердикты старше `requestedAt` — каждая попытка своей транзакцией под `lockEntry`, повтор задачи идемпотентен.
 */
export const RESULTS_RACE_RECHECK_REQUESTED = 'results.race-recheck-requested';
export const ResultsRaceRecheckRequested = z.object({
  raceId: z.uuid(),
  requestedAt: z.iso.datetime(),
});
export type ResultsRaceRecheckRequested = z.infer<typeof ResultsRaceRecheckRequested>;

/**
 * Видимый вердикт попытки сменился (notifications, RC-2): пишет `AttemptCheckProcessor.record` в транзакции вердикта,
 * только при смене `lastVisibleVerdict` на `counted`/`rejected`. Маршрут — у подписчика (`notificationsOutboxRoutes`).
 */
export const RESULTS_ATTEMPT_VERDICT_CHANGED = 'results.attempt-verdict-changed';
export const ResultsAttemptVerdictChanged = z.object({
  attemptId: z.uuid(),
  raceId: z.uuid(),
  userId: z.uuid(),
  status: z.enum(['counted', 'rejected']),
});
export type ResultsAttemptVerdictChanged = z.infer<typeof ResultsAttemptVerdictChanged>;

/**
 * Протокол гонки опубликован (D-22): маршрут — у подписчика `notifications` (`notificationsOutboxRoutes`, ADR-0016);
 * рейтингу сезона (слайс 08) нужен fan-out outbox (ADR-0016 п. 5).
 */
export const RESULTS_PROTOCOL_PUBLISHED = 'results.protocol-published';
export const ResultsProtocolPublished = z.object({
  raceId: z.uuid(),
  revision: z.number().int().positive(),
});
export type ResultsProtocolPublished = z.infer<typeof ResultsProtocolPublished>;

/** Новая ревизия опубликованного протокола (D-27, D-28): маршрут — у `notifications`, как `protocol-published`. */
export const RESULTS_RESULT_REVISED = 'results.result-revised';
export const ResultsResultRevised = z.object({
  raceId: z.uuid(),
  revision: z.number().int().positive(),
  kind: z.enum(['disqualified', 'disqualification_revoked', 'recheck_applied']),
  entryId: z.uuid().nullable(),
});
export type ResultsResultRevised = z.infer<typeof ResultsResultRevised>;

/**
 * Маршруты событий для очередей `results` (подключает worker.module.ts): свои события и подписка на события
 * `tracks` (тип события → одна очередь: у подписчика — свои типы, `tracks.upload-deleted` слушает `devices`).
 */
export const resultsOutboxRoutes = {
  [TRACK_ACTIVITY_READY]: QUEUE.resultsIntake,
  [TRACK_ACTIVITY_REMOVED]: QUEUE.resultsIntake,
  [RESULTS_ENTRY_CREATED]: QUEUE.resultsIntake,
  [RESULTS_RACE_RECHECK_REQUESTED]: QUEUE.resultsIntake,
  [RESULTS_ATTEMPT_CHECK_REQUESTED]: QUEUE.attemptCheck,
} as const;
