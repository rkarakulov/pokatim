import { NOTIFICATION_KINDS, NotificationTarget } from '@pokatim/contracts';
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
import { PROFILE_FIELD_RESET } from '../profile';
import { ACHIEVEMENTS_GRANT_NOTICED } from '../achievements';

/**
 * Маршруты событий модулей-источников в очередь приёма уведомлений (ADR-0017): объявляет подписчик (как
 * `resultsOutboxRoutes` для `tracks.*`), подключает `src/outbox-routes.ts` (`mergeOutboxRoutes`: другие подписчики тех
 * же типов получают свою задачу — fan-out, ADR-0017 п. 5). Имя задачи = тип события, jobId = id события.
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
  [PROFILE_FIELD_RESET]: QUEUE.notificationsIntake,
  // achievements-push: новое достижение или уровень (порт `ACHIEVEMENT_NOTICES`)
  [ACHIEVEMENTS_GRANT_NOTICED]: QUEUE.notificationsIntake,
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

/**
 * Пачка получателей события (`notifications-intake`, имя задачи — не тип события outbox): то, что intake уже посчитал —
 * снимок текста, цель, схлопывание, цели и id получателей пачки. Порты источников в пачке не перечитываются. Без ПДн
 * (N12): id и снимок текста.
 */
export const NOTIFICATIONS_FANOUT_JOB = 'notifications.fanout';
/**
 * Потолок получателей в данных пачки — не `fanoutChunk`: смена размера пачки не делает нечитаемыми уже поставленные
 * задачи.
 */
export const FANOUT_CHUNK_MAX = 1000;

export const FanoutJobData = z.object({
  eventId: z.uuid(),
  /** тип события-источника — только для логов */
  type: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  target: NotificationTarget.nullable(),
  targets: z.record(z.uuid(), NotificationTarget).optional(),
  collapse: z.object({ key: z.string(), seq: z.number().int().optional() }).optional(),
  /** в центр без push (`reason: 'in_app'`): райдер сейчас в приложении (achievements-push, P1) */
  inApp: z.boolean().optional(),
  userIds: z.array(z.uuid()).min(1).max(FANOUT_CHUNK_MAX),
});
export type FanoutJobData = z.infer<typeof FanoutJobData>;

/**
 * План раскладки события — в данных задачи intake (`job.updateData` до постановки): повтор intake ставит пачки по нему,
 * порты источников не зовутся (состав зафиксирован), недоставленные пачки дотягиваются.
 */
export const FanoutPlan = z
  .array(z.object({ jobId: z.string().startsWith('fanout-'), data: FanoutJobData }))
  .min(1);
export type FanoutPlan = z.infer<typeof FanoutPlan>;

/** Данные задачи intake: событие outbox (`OutboxJobData`) и, после раскладки, её план. */
export const IntakeJobData = z.object({ outboxEventId: z.uuid(), fanout: FanoutPlan.optional() });
export type IntakeJobData = z.infer<typeof IntakeJobData>;

/** jobId пачки: событие, номер непустого черновика, номер пачки; без `:` (BullMQ). */
export const fanoutJobId = (eventId: string, draft: number, chunk: number) =>
  `fanout-${eventId}-${draft}-${chunk}`;
