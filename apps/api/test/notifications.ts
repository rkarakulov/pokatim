import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import {
  type NotificationDoc,
  notificationsCollections,
} from '../src/modules/notifications/notifications.collection';
import { NOTIFICATIONS_POLICY } from '../src/modules/notifications/notifications.policy';
import { DAY, type Harness } from './harness';

export const NOTIFICATIONS = '/v1/notifications';

/** Коллекции центра уведомлений тестовой БД. */
export const notificationsDb = (h: Harness) => notificationsCollections(h.db);

/**
 * Уведомление прямой вставкой (шаг A: intake ещё нет): по умолчанию — непрочитанное «Новый участник», создано «сейчас»
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
