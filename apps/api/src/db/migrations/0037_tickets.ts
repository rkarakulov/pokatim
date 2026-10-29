import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { TICKETS_COLLECTIONS } from '../../modules/tickets/tickets.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы билетов (event-tickets, ADR-0023): код, хэш QR и регистрация — уникальны (дубль кода — новый код; дубль
 * регистрации — параллельная сверка выпустила билет); «мои билеты» — `(userId, createdAt)`; сверка гонки и список
 * участников с курсором — `(kind, eventId, _id)`. Регистрации календаря — одна активная на `(eventId, userId)`
 * (частичный), «мои регистрации» и стирание — `(userId, createdAt)`. Настройки — выборка включённых гонок регламентом.
 */
export const TICKETS_INDEXES = {
  [TICKETS_COLLECTIONS.tickets]: [
    { key: { code: 1 }, options: { name: 'tickets_code_unique', unique: true } },
    { key: { qrHash: 1 }, options: { name: 'tickets_qr_hash_unique', unique: true } },
    { key: { registrationId: 1 }, options: { name: 'tickets_registration_unique', unique: true } },
    { key: { userId: 1, createdAt: -1 }, options: { name: 'tickets_user_idx' } },
    { key: { kind: 1, eventId: 1, _id: 1 }, options: { name: 'tickets_event_idx' } },
  ],
  [TICKETS_COLLECTIONS.registrations]: [
    {
      key: { eventId: 1, userId: 1 },
      options: {
        name: 'event_registrations_active_unique',
        unique: true,
        partialFilterExpression: { status: 'active' },
      },
    },
    { key: { userId: 1, createdAt: -1 }, options: { name: 'event_registrations_user_idx' } },
  ],
  [TICKETS_COLLECTIONS.ticketing]: [
    { key: { kind: 1, enabled: 1 }, options: { name: 'event_ticketing_enabled_idx' } },
  ],
} as const satisfies Record<string, readonly IndexDef[]>;

/**
 * Билеты на мероприятия (event-tickets): коллекции `event_ticketing`, `event_registrations`, `tickets` и индексы.
 * Expand-only, без транзакции и бэкфилла (билеты выпускает сверка), идемпотентна. После `0036_overview_indexes`.
 */
export const tickets: MongoMigration = {
  id: '0037_tickets',
  async up(db) {
    for (const [name, indexes] of Object.entries(TICKETS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
