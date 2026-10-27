import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { NOTIFICATIONS_COLLECTIONS } from '../../modules/notifications/notifications.collection';

/**
 * Владелец тикета Expo (notifications, pass 2): `push_tickets.userId` пишет доставка, стирание аккаунта удаляет тикеты
 * по нему — токены к этому времени уже сняты транзакцией удаления. Тикеты без поля (до миграции) уберёт TTL 24 ч.
 * Expand-only, без транзакции, идемпотентна (`createIndex` того же индекса — без ошибки).
 */
export const pushTicketsUser: MongoMigration = {
  id: '0027_push_tickets_user',
  async up(db) {
    await db
      .collection(NOTIFICATIONS_COLLECTIONS.pushTickets)
      .createIndex({ userId: 1 }, { name: 'push_tickets_user_idx' });
  },
};
