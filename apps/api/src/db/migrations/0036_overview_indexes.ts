import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';
import { TRACKS_COLLECTIONS } from '../../modules/tracks/tracks.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * KPI «Обзора» панели (admin-overview): регистрации и загрузки за 7 суток — диапазон по `createdAt` без полного
 * просмотра коллекций (существующий `users_unverified_created_at_idx` частичный — только неподтверждённые).
 */
export const OVERVIEW_INDEXES = {
  usersCreatedAt: {
    key: { createdAt: 1 },
    options: { name: 'users_created_at_idx' },
  },
  uploadsCreatedAt: {
    key: { createdAt: 1 },
    options: { name: 'track_uploads_created_at_idx' },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Индексы KPI «Обзора» панели (admin-overview). Expand-only, без транзакции и бэкфилла, идемпотентна. После
 * `0035_achievements`.
 */
export const overviewIndexes: MongoMigration = {
  id: '0036_overview_indexes',
  async up(db) {
    const target = {
      usersCreatedAt: IDENTITY_COLLECTIONS.users,
      uploadsCreatedAt: TRACKS_COLLECTIONS.uploads,
    } as const;
    for (const [name, { key, options }] of Object.entries(OVERVIEW_INDEXES)) {
      await db.collection(target[name as keyof typeof target]).createIndex(key, options);
    }
  },
};
