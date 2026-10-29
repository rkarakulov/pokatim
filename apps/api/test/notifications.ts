import { randomBytes } from 'node:crypto';

import { getQueueToken } from '@nestjs/bullmq';

import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';

import { OUTBOX_COLLECTION, type MongoOutboxDoc } from '../src/db';
import { QUEUE } from '../src/queues';
import { NotificationsDeliveryProcessor } from '../src/modules/notifications/notifications-delivery.processor';
import { NotificationsMaintenanceProcessor } from '../src/modules/notifications/notifications-maintenance.processor';
import {
  type IntakeOutcome,
  NotificationsIntakeProcessor,
} from '../src/modules/notifications/notifications-intake.processor';
import {
  NOTIFICATIONS_EMAIL_JOB,
  NOTIFICATIONS_PUSH_JOB,
  NOTIFICATIONS_RECEIPTS_JOB,
  NOTIFICATIONS_REDELIVER_JOB,
  notificationsOutboxRoutes,
} from '../src/modules/notifications/notifications.events';
import {
  type NotificationDoc,
  notificationsCollections,
} from '../src/modules/notifications/notifications.collection';
import { NOTIFICATIONS_POLICY } from '../src/modules/notifications/notifications.policy';
import { DAY, type Harness } from './harness';
import { collections, outboxEvents } from './identity';

export const NOTIFICATIONS = '/v1/notifications';

/** Коллекции центра уведомлений тестовой БД. */
export const notificationsDb = (h: Harness) => notificationsCollections(h.db);

/**
 * Уведомление прямой вставкой (тесты HTTP центра; запись intake проверяет `notifications-intake.int.test.ts`): по умолчанию — непрочитанное «Новый участник», создано «сейчас»
 * стенда, живёт 90 дней. Возвращает документ.
 */
export async function seedNotification(
  h: Harness,
  userId: string,
  overrides: Partial<NotificationDoc> = {},
): Promise<NotificationDoc> {
  const createdAt = overrides.createdAt ?? h.clock.now();
  const doc: NotificationDoc = {
    _id: uuidv7(),
    userId,
    kind: 'ride_joined',
    group: 'rides',
    title: 'Новый участник',
    body: '«Кофе-райд»: участников — 2.',
    target: { type: 'ride', rideId: uuidv7() },
    sourceEventId: uuidv7(),
    createdAt,
    readAt: null,
    expireAt: new Date(createdAt.getTime() + NOTIFICATIONS_POLICY.ttlDays * DAY),
    push: {
      state: 'skipped',
      notBefore: createdAt,
      claimId: null,
      claimedUntil: null,
      sentAt: null,
      reason: 'disabled',
    },
    email: null,
    ...overrides,
  };
  await notificationsDb(h).notifications.insertOne(doc);
  return doc;
}

/** Корректный токен Expo с суффиксом (уникальный на тест). */
export const expoToken = (suffix: string) => `ExponentPushToken[device-${suffix.padEnd(10, 'x')}]`;

/**
 * uuidv7 на заданный момент (первые 48 бит — Unix-время в мс): событие outbox «в прошлом» стенда — `uuidv7()` базы
 * берёт `Date.now()`, а не `CLOCK` (task §7).
 */
export function uuidv7At(at: Date): string {
  const hex = at.getTime().toString(16).padStart(12, '0') + randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Событие outbox прямой вставкой (невалидный payload, событие «на момент» или с заданным id); id. */
export async function appendEvent(
  h: Harness,
  type: string,
  payload: Record<string, unknown>,
  at?: Date | string,
): Promise<string> {
  const _id = typeof at === 'string' ? at : at ? uuidv7At(at) : uuidv7();
  await h.db.collection<MongoOutboxDoc>(OUTBOX_COLLECTION).insertOne({
    _id,
    type,
    payload,
    createdAt: h.clock.now(),
    publishedAt: null,
  });
  return _id;
}

/** События outbox типа по порядку записи. */
export const eventsOfType = async (h: Harness, type: string) =>
  (await outboxEvents(h)).filter((event) => event.type === type);

const intakeJob = (name: string, outboxEventId: string) =>
  ({
    name,
    data: { outboxEventId },
    attemptsMade: 0,
    opts: { attempts: 5 },
  }) as unknown as Job<OutboxJobData>;

/** Задача приёма уведомлений по событию outbox (как публикатор + worker): имя задачи = тип события. */
export const runIntake = (h: Harness, type: string, eventId: string): Promise<IntakeOutcome> =>
  h.worker.get(NotificationsIntakeProcessor).process(intakeJob(type, eventId));

/**
 * Приём всех событий маршрутов `notifications`, ещё не обработанных этим обработчиком, по порядку записи; итог по id
 * события.
 */
export function notificationsIntake(h: Harness) {
  const handled = new Map<string, IntakeOutcome>();
  const types = Object.keys(notificationsOutboxRoutes);
  return {
    handled,
    async drain(): Promise<IntakeOutcome[]> {
      const outcomes: IntakeOutcome[] = [];
      for (const event of await outboxEvents(h)) {
        if (!types.includes(event.type) || handled.has(event._id)) continue;
        const outcome = await runIntake(h, event.type, event._id);
        handled.set(event._id, outcome);
        outcomes.push(outcome);
      }
      return outcomes;
    },
  };
}

/** Уведомления пользователя, новые сверху. */
export const notificationsOf = (h: Harness, userId: string) =>
  notificationsDb(h).notifications.find({ userId }).sort({ createdAt: -1, _id: -1 }).toArray();

/**
 * Push-токен устройства прямой вставкой (регистрацию по HTTP проверяет `notifications.int.test.ts`), привязан к
 * сессии `sessionId` или последней сессии пользователя; id документа.
 */
export async function seedPushToken(
  h: Harness,
  userId: string,
  suffix: string,
  sessionId?: string,
): Promise<string> {
  const now = h.clock.now();
  const _id = uuidv7();
  // по умолчанию — последняя сессия пользователя (как регистрация из приложения под этой сессией)
  const session = sessionId
    ? { _id: sessionId }
    : await collections(h).sessions.findOne({ userId }, { sort: { createdAt: -1 } });
  await notificationsDb(h).pushTokens.insertOne({
    _id,
    token: expoToken(suffix),
    userId,
    sessionId: session?._id ?? uuidv7(),
    platform: 'ios',
    createdAt: now,
    updatedAt: now,
  });
  return _id;
}

const deliveryJob = (name: string, data: unknown, attemptsMade: number) =>
  ({ name, data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job;

/** Задача push пользователя, как её отдал бы worker (`attemptsMade` — номер попытки, 4 — последняя). */
export const runPush = (h: Harness, userId: string, attemptsMade = 0) =>
  h.worker
    .get(NotificationsDeliveryProcessor)
    .process(deliveryJob(NOTIFICATIONS_PUSH_JOB, { userId }, attemptsMade));

/** Задача письма уведомления. */
export const runEmail = (h: Harness, notificationId: string, attemptsMade = 0) =>
  h.worker
    .get(NotificationsDeliveryProcessor)
    .process(deliveryJob(NOTIFICATIONS_EMAIL_JOB, { notificationId }, attemptsMade));

/** Регламент: квитанции Expo / перепостановка потерянных доставок. */
export const runReceipts = (h: Harness) =>
  h.worker
    .get(NotificationsMaintenanceProcessor)
    .process(deliveryJob(NOTIFICATIONS_RECEIPTS_JOB, {}, 0));
export const runRedeliver = (h: Harness) =>
  h.worker
    .get(NotificationsMaintenanceProcessor)
    .process(deliveryJob(NOTIFICATIONS_REDELIVER_JOB, {}, 0));

/** Очередь доставки графа worker (туда intake и регламент ставят задачи). */
export const deliveryQueue = (h: Harness): Queue =>
  h.worker.get(getQueueToken(QUEUE.notificationsDelivery), { strict: false });

/** Ждущие задачи доставки: имя, jobId, данные, задержка. */
export async function deliveryJobs(h: Harness) {
  const jobs = await deliveryQueue(h).getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs
    .map((job) => ({
      name: job.name,
      id: job.id,
      data: job.data as unknown,
      delay: job.opts.delay ?? 0,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
