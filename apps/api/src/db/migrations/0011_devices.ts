import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import {
  DEVICES_COLLECTIONS,
  LIVE_CONNECTION_STATUSES,
} from '../../modules/devices/devices.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы устройств (tracks-devices, агрегатор): пользователь агрегатора уникален, одно живое подключение на
 * `(userId, provider)`, уборка `pending`, TTL тикетов, импорт тренировки уникален, журнал пользователя.
 */
export const DEVICES_INDEXES: Record<string, IndexDef[]> = {
  [DEVICES_COLLECTIONS.accounts]: [
    {
      key: { aggregator: 1, aggUserId: 1 },
      options: { name: 'device_accounts_agg_user_unique', unique: true },
    },
  ],
  [DEVICES_COLLECTIONS.connections]: [
    {
      key: { userId: 1, provider: 1 },
      options: {
        name: 'device_connections_user_provider_live_unique',
        unique: true,
        partialFilterExpression: { status: { $in: [...LIVE_CONNECTION_STATUSES] } },
      },
    },
    { key: { aggUserId: 1 }, options: { name: 'device_connections_agg_user_idx' } },
    { key: { status: 1, pendingUntil: 1 }, options: { name: 'device_connections_status_idx' } },
  ],
  [DEVICES_COLLECTIONS.tickets]: [
    { key: { expiresAt: 1 }, options: { name: 'device_link_tickets_ttl', expireAfterSeconds: 0 } },
  ],
  [DEVICES_COLLECTIONS.imports]: [
    {
      key: { provider: 1, aggWorkoutId: 1 },
      options: { name: 'device_imports_workout_unique', unique: true },
    },
    {
      key: { uploadId: 1 },
      options: {
        name: 'device_imports_upload_idx',
        partialFilterExpression: { uploadId: { $type: 'string' } },
      },
    },
  ],
  [DEVICES_COLLECTIONS.audit]: [
    { key: { userId: 1, _id: -1 }, options: { name: 'device_audit_user_idx' } },
  ],
};

/** Устройства через агрегатор (tracks-devices): коллекции и индексы. Expand-only, без транзакции, идемпотентна. */
export const devices: MongoMigration = {
  id: '0011_devices',
  async up(db) {
    for (const [name, indexes] of Object.entries(DEVICES_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
