import { z } from 'zod';

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
import { ROUTE_PUBLICATION_DECIDED } from '../routes';
import { TICKETS_REMINDER_DUE } from '../tickets';

/**
 * Маршруты событий модулей-источников в очередь приёма уведомлений (ADR-0017): объявляет подписчик (как
 * `resultsOutboxRoutes` для `tracks.*`), подключает worker.module.ts. Тип события → одна очередь: другим подписчикам
 * этих типов нужен fan-out outbox (ADR-0017 п. 5). Имя задачи = тип события, jobId = id события.
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
  [ROUTE_PUBLICATION_DECIDED]: QUEUE.notificationsIntake,
  // PR D event-tickets: напоминание о событии (порт `TICKET_NOTICES`)
  [TICKETS_REMINDER_DUE]: QUEUE.notificationsIntake,
} as const;

export type NotificationSourceEvent = keyof typeof notificationsOutboxRoutes;

export const isNotificationSourceEvent = (type: string): type is NotificationSourceEvent =>
  Object.hasOwn(notificationsOutboxRoutes, type);

/** Задачи доставки (`notifications-delivery`): push — по пользователю, письмо — по уведомлению. */
export const NOTIFICATIONS_PUSH_JOB = 'notifications.push';
export const NOTIFICATIONS_EMAIL_JOB = 'notifications.email';
/** Регламент (`notifications-maintenance`): квитанции Expo и перепостановка потерянных доставок. */
export const NOTIFICATIONS_RECEIPTS_JOB = 'notifications.receipts';
export const NOTIFICATIONS_REDELIVER_JOB = 'notifications.redeliver';

export const PushJobData = z.object({ userId: z.uuid() });
export type PushJobData = z.infer<typeof PushJobData>;
export const EmailJobData = z.object({ notificationId: z.uuid() });
export type EmailJobData = z.infer<typeof EmailJobData>;

/**
 * jobId push: пользователь и срок (`notBefore`, мс) — отложенные до конца тихих часов уведомления одного пользователя
 * собираются одной задачей (сводка), повтор intake ставит ту же задачу. Без `:` (BullMQ).
 */
export const pushJobId = (userId: string, notBefore: Date) =>
  `push-${userId}-${notBefore.getTime()}`;
/** jobId письма — по уведомлению. */
export const emailJobId = (notificationId: string) => `email-${notificationId}`;
