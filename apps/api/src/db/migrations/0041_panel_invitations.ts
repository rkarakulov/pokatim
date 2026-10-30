import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PANEL_COLLECTIONS } from '../../modules/panel/panel.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы приглашений в команду (ADR-0026): уникальный хеш токена; одно `pending` на адрес (частичный уникальный —
 * гонку двух приглашений ловит индекс, вызывающий повторяет транзакцию); блок «Приглашения» — `pending` новыми сверху;
 * TTL-уборка по `purgeAt` (срок ссылки проверяет сервер по `CLOCK`).
 */
export const PANEL_INVITATIONS_INDEXES = {
  [PANEL_COLLECTIONS.invitations]: [
    {
      key: { tokenHash: 1 },
      options: { name: 'panel_invitations_token_hash_unique', unique: true },
    },
    {
      key: { email: 1 },
      options: {
        name: 'panel_invitations_pending_email_unique',
        unique: true,
        partialFilterExpression: { status: 'pending' },
      },
    },
    {
      key: { status: 1, createdAt: -1, _id: -1 },
      options: { name: 'panel_invitations_status_created_idx' },
    },
    {
      key: { purgeAt: 1 },
      options: { name: 'panel_invitations_purge_ttl', expireAfterSeconds: 0 },
    },
  ],
} as const satisfies Record<string, readonly IndexDef[]>;

/**
 * Приглашения в команду панели «Протокол» (panel-invitations, ADR-0026): коллекция `panel_invitations` и индексы.
 * Expand-only, без транзакции и бэкфилла, идемпотентна. После `0040_panel_totp`.
 */
export const panelInvitations: MongoMigration = {
  id: '0041_panel_invitations',
  async up(db) {
    for (const [name, indexes] of Object.entries(PANEL_INVITATIONS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
