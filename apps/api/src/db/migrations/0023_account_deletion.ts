import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { DEVICES_COLLECTIONS } from '../../modules/devices/devices.collection';
import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';

/** Удалённые аккаунты без завершённого повторного прохода очистки — регламент resume (ADR-0015). */
export const USERS_ERASURE_PENDING_INDEX = 'users_erasure_pending_idx';

/**
 * Удаление аккаунта (account-deletion, ADR-0015). Expand-only, без транзакции, идемпотентна:
 * - индексы `userId` данных устройств — стирание `deleteMany({ userId })` без COLLSCAN (частичный уникальный индекс
 *   подключений покрывает только живые);
 * - частичный `users_erasure_pending_idx` — удалённые без `erasureSweptAt` (`$eq: null` совпадает и с отсутствием
 *   поля). `users_email_unique` не меняется.
 */
export const accountDeletion: MongoMigration = {
  id: '0023_account_deletion',
  async up(db) {
    for (const [collection, name] of [
      [DEVICES_COLLECTIONS.connections, 'device_connections_user_idx'],
      [DEVICES_COLLECTIONS.imports, 'device_imports_user_idx'],
      [DEVICES_COLLECTIONS.tickets, 'device_link_tickets_user_idx'],
    ] as const) {
      await db.collection(collection).createIndex({ userId: 1 }, { name });
    }
    await db.collection(IDENTITY_COLLECTIONS.users).createIndex(
      { deletedAt: 1 },
      {
        name: USERS_ERASURE_PENDING_INDEX,
        partialFilterExpression: { deletedAt: { $type: 'date' }, erasureSweptAt: { $eq: null } },
      },
    );
  },
};
