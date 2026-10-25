import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PANEL_COLLECTIONS, type PanelMetaDoc } from '../../modules/panel/panel.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Уборка сессий панели — через 30 дней после абсолютного срока (истечение проверяет сервер по `CLOCK`). */
export const PANEL_SESSION_TTL_SECONDS = 30 * 24 * 3600;

/** Индексы коллекций панели; имена — для `isDuplicateKey` и тестов. */
export const PANEL_INDEXES: Record<string, IndexDef[]> = {
  [PANEL_COLLECTIONS.members]: [
    // подсчёт активных администраторов (R7) и фильтры списка
    { key: { role: 1, status: 1 }, options: { name: 'panel_members_role_status_idx' } },
  ],
  [PANEL_COLLECTIONS.sessions]: [
    {
      key: { tokenHash: 1 },
      options: { name: 'panel_sessions_token_hash_unique', unique: true },
    },
    { key: { userId: 1 }, options: { name: 'panel_sessions_user_id_idx' } },
    {
      key: { expiresAt: 1 },
      options: {
        name: 'panel_sessions_expires_at_ttl',
        expireAfterSeconds: PANEL_SESSION_TTL_SECONDS,
      },
    },
  ],
  [PANEL_COLLECTIONS.audit]: [
    { key: { action: 1, _id: -1 }, options: { name: 'panel_audit_action_idx' } },
    { key: { 'actor.userId': 1, _id: -1 }, options: { name: 'panel_audit_actor_idx' } },
    { key: { targetUserId: 1, _id: -1 }, options: { name: 'panel_audit_target_idx' } },
  ],
  [PANEL_COLLECTIONS.meta]: [],
};

/**
 * Панель «Протокол» (admin-01): члены команды, сессии панели, журнал (append-only), документ-замок
 * администраторов `panel_meta.admins`. Expand-only, без транзакции, идемпотентна.
 */
export const panel: MongoMigration = {
  id: '0005_panel',
  async up(db) {
    for (const [name, indexes] of Object.entries(PANEL_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection<PanelMetaDoc>(PANEL_COLLECTIONS.meta)
      .updateOne({ _id: 'admins' }, { $setOnInsert: { version: 0 } }, { upsert: true });
  },
};
