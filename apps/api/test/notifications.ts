import { randomBytes } from 'node:crypto';

import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { OUTBOX_COLLECTION, type MongoOutboxDoc } from '../src/db';
import {
  type IntakeOutcome,
  NotificationsIntakeProcessor,
} from '../src/modules/notifications/notifications-intake.processor';
import { notificationsOutboxRoutes } from '../src/modules/notifications/notifications.events';
import {
  type NotificationDoc,
  notificationsCollections,
} from '../src/modules/notifications/notifications.collection';
import { NOTIFICATIONS_POLICY } from '../src/modules/notifications/notifications.policy';
import { DAY, type Harness } from './harness';
import { outboxEvents } from './identity';

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

/** Событие outbox прямой вставкой (невалидный payload, событие «на момент»); id. */
export async function appendEvent(
  h: Harness,
  type: string,
  payload: Record<string, unknown>,
  at?: Date,
): Promise<string> {
  const _id = at ? uuidv7At(at) : uuidv7();
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
