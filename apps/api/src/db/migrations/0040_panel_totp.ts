import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PANEL_COLLECTIONS } from '../../modules/panel/panel.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Уборка вызовов и доверенных устройств — через сутки после срока (истечение проверяет сервер по `CLOCK`). */
export const PANEL_TOTP_TTL_GRACE_SECONDS = 24 * 3600;

/**
 * Индексы 2FA панели (ADR-0024): `panel_totp` — по `_id` (userId), индексов нет; вызов входа и доверенное устройство —
 * уникальный хеш токена, TTL по `expiresAt`; устройства — `(userId, createdAt)` для вытеснения старых (≤ 10).
 */
export const PANEL_TOTP_INDEXES = {
  [PANEL_COLLECTIONS.totp]: [],
  [PANEL_COLLECTIONS.challenges]: [
    {
      key: { tokenHash: 1 },
      options: { name: 'panel_challenges_token_hash_unique', unique: true },
    },
    {
      key: { expiresAt: 1 },
      options: {
        name: 'panel_challenges_expires_at_ttl',
        expireAfterSeconds: PANEL_TOTP_TTL_GRACE_SECONDS,
      },
    },
  ],
  [PANEL_COLLECTIONS.devices]: [
    { key: { tokenHash: 1 }, options: { name: 'panel_devices_token_hash_unique', unique: true } },
    { key: { userId: 1, createdAt: -1 }, options: { name: 'panel_devices_user_idx' } },
    {
      key: { expiresAt: 1 },
      options: {
        name: 'panel_devices_expires_at_ttl',
        expireAfterSeconds: PANEL_TOTP_TTL_GRACE_SECONDS,
      },
    },
  ],
} as const satisfies Record<string, readonly IndexDef[]>;

/**
 * 2FA панели «Протокол» (panel-2fa, ADR-0024): коллекции `panel_totp`, `panel_sign_in_challenges`,
 * `panel_trusted_devices` и индексы. `panel_sessions.secondFactor` — необязательное поле, старые документы не
 * меняются. Expand-only, без транзакции и бэкфилла, идемпотентна. После `0038_tickets`.
 */
export const panelTotp: MongoMigration = {
  id: '0040_panel_totp',
  async up(db) {
    for (const [name, indexes] of Object.entries(PANEL_TOTP_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
