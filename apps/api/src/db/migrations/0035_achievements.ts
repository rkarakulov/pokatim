import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ACHIEVEMENTS_COLLECTIONS } from '../../modules/achievements/achievements.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индекс выдач (achievements, RC-1): одна выдача на `(userId, code)` — параллельные сверки не создают дублей
 * (`isDuplicateKey`); префикс `userId` — список, отзыв, «показано» и стирание. Маркер `achievement_syncs` — по `_id`.
 */
export const ACHIEVEMENTS_INDEXES = {
  grantsUserCodeUnique: {
    key: { userId: 1, code: 1 },
    options: { name: 'achievement_grants_user_code_unique', unique: true },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Достижения (achievements, ADR-0020): коллекции `achievement_grants`, `achievement_syncs` и уникальный индекс выдачи.
 * Expand-only, без транзакции, без бэкфилла (первая сверка райдера выдаёт тихо, A3), идемпотентна. После
 * `0034_profile_reports`.
 */
export const achievements: MongoMigration = {
  id: '0035_achievements',
  async up(db) {
    await ensureCollection(db, ACHIEVEMENTS_COLLECTIONS.grants);
    await ensureCollection(db, ACHIEVEMENTS_COLLECTIONS.syncs);
    const { key, options } = ACHIEVEMENTS_INDEXES.grantsUserCodeUnique;
    await db.collection(ACHIEVEMENTS_COLLECTIONS.grants).createIndex(key, options);
  },
};
