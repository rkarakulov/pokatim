import { QUEUE } from '../../queues';
import {
  DISPUTES_DISPUTE_DECIDED,
  DISPUTES_DISPUTE_FILED,
  DISPUTES_DISPUTE_RESPONDED,
  DISPUTES_DISPUTE_WITHDRAWN,
} from '../disputes';
import {
  RESULTS_ATTEMPT_VERDICT_CHANGED,
  RESULTS_PROTOCOL_PUBLISHED,
  RESULTS_RESULT_REVISED,
} from '../results';
import {
  RIDES_PARTICIPANT_JOINED,
  RIDES_REPORTS_RESOLVED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
} from '../rides';

/**
 * Маршруты событий модулей-источников в очередь приёма уведомлений (ADR-0016): объявляет подписчик (как
 * `resultsOutboxRoutes` для `tracks.*`), подключает worker.module.ts. Тип события → одна очередь: другим подписчикам
 * этих типов нужен fan-out outbox (ADR-0016 п. 5). Имя задачи = тип события, jobId = id события.
 */
export const notificationsOutboxRoutes = {
  [RESULTS_ATTEMPT_VERDICT_CHANGED]: QUEUE.notificationsIntake,
  [RESULTS_PROTOCOL_PUBLISHED]: QUEUE.notificationsIntake,
  [RESULTS_RESULT_REVISED]: QUEUE.notificationsIntake,
  [DISPUTES_DISPUTE_FILED]: QUEUE.notificationsIntake,
  [DISPUTES_DISPUTE_WITHDRAWN]: QUEUE.notificationsIntake,
  [DISPUTES_DISPUTE_RESPONDED]: QUEUE.notificationsIntake,
  [DISPUTES_DISPUTE_DECIDED]: QUEUE.notificationsIntake,
  [RIDES_RIDE_CANCELLED]: QUEUE.notificationsIntake,
  [RIDES_RIDE_RESCHEDULED]: QUEUE.notificationsIntake,
  [RIDES_PARTICIPANT_JOINED]: QUEUE.notificationsIntake,
  [RIDES_REPORTS_RESOLVED]: QUEUE.notificationsIntake,
} as const;

export type NotificationSourceEvent = keyof typeof notificationsOutboxRoutes;

export const isNotificationSourceEvent = (type: string): type is NotificationSourceEvent =>
  Object.hasOwn(notificationsOutboxRoutes, type);
