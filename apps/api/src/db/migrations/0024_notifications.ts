import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { NOTIFICATIONS_COLLECTIONS } from '../../modules/notifications/notifications.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы центра уведомлений (ADR-0016). Имена уникальных — для `isDuplicateKey`:
 * - `notifications_event_user_unique` — одно уведомление на (событие, получатель): повтор intake не дублирует;
 * - `notifications_collapse_unique` — одно на (получатель, `collapseKey`), только у документов с ключом (N7);
 * - список с курсором и стирание — `user_list`, счётчик и «Прочитать все» — частичный `user_unread`;
 * - очереди доставки — частичные `push_due`/`email_due` (запрос обязан содержать условие частичного фильтра);
 * - TTL `expireAt` (90 дней уведомлений, 24 ч тикетов) — только уборка;
 * - токены: глобально уникальный `token`, лимит 10 на пользователя — `push_tokens_user_idx` (старейший по `updatedAt`).
 */
export const NOTIFICATIONS_INDEXES: Record<string, IndexDef[]> = {
  [NOTIFICATIONS_COLLECTIONS.notifications]: [
    {
      key: { sourceEventId: 1, userId: 1 },
      options: { name: 'notifications_event_user_unique', unique: true },
    },
    {
      key: { userId: 1, collapseKey: 1 },
      options: {
        name: 'notifications_collapse_unique',
        unique: true,
        partialFilterExpression: { collapseKey: { $type: 'string' } },
      },
    },
    {
      key: { userId: 1, createdAt: -1, _id: -1 },
      options: { name: 'notifications_user_list_idx' },
    },
    {
      key: { userId: 1 },
      options: {
        name: 'notifications_user_unread_idx',
        partialFilterExpression: { readAt: { $eq: null } },
      },
    },
    {
      key: { 'push.state': 1, 'push.notBefore': 1 },
      options: {
        name: 'notifications_push_due_idx',
        partialFilterExpression: { 'push.state': { $in: ['pending', 'sending'] } },
      },
    },
    {
      key: { 'email.state': 1 },
      options: {
        name: 'notifications_email_due_idx',
        partialFilterExpression: { 'email.state': { $in: ['pending', 'sending'] } },
      },
    },
    {
      key: { expireAt: 1 },
      options: { name: 'notifications_expire_ttl', expireAfterSeconds: 0 },
    },
  ],
  [NOTIFICATIONS_COLLECTIONS.settings]: [],
  [NOTIFICATIONS_COLLECTIONS.pushTokens]: [
    { key: { token: 1 }, options: { name: 'push_tokens_token_unique', unique: true } },
    { key: { userId: 1, updatedAt: 1 }, options: { name: 'push_tokens_user_idx' } },
  ],
  [NOTIFICATIONS_COLLECTIONS.pushTickets]: [
    { key: { ticketId: 1 }, options: { name: 'push_tickets_ticket_unique', unique: true } },
    { key: { createdAt: 1 }, options: { name: 'push_tickets_created_idx' } },
    { key: { expireAt: 1 }, options: { name: 'push_tickets_expire_ttl', expireAfterSeconds: 0 } },
  ],
};

/**
 * Центр уведомлений (ADR-0016): коллекции `notifications`, `notification_settings`, `push_tokens`, `push_tickets` и
 * их индексы. Expand-only, без транзакции, идемпотентна (`createIndex` того же индекса — без ошибки).
 */
export const notifications: MongoMigration = {
  id: '0024_notifications',
  async up(db) {
    for (const [name, indexes] of Object.entries(NOTIFICATIONS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
