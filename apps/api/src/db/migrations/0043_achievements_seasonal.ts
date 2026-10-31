import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ACHIEVEMENTS_COLLECTIONS } from '../../modules/achievements/achievements.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индекс сезонных выдач (achievements-seasonal, S3): одна выдача на `(userId, code, seasonId)` — параллельные сверки
 * не создают дублей (`isDuplicateKey`); префикс `userId` — список, «показано» и стирание.
 */
export const ACHIEVEMENT_SEASON_INDEXES = {
  userCodeSeasonUnique: {
    key: { userId: 1, code: 1, seasonId: 1 },
    options: { name: 'achievement_season_grants_user_code_season_unique', unique: true },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Сезонные достижения (achievements-seasonal, ADR-0020 «Дополнение: сезонные», HG-S1): коллекция
 * `achievement_season_grants` и её уникальный индекс. Только expand: `achievement_grants` и его индекс не трогаются;
 * без транзакции, без бэкфилла, идемпотентна. После `0042_profile_report_reasons`.
 */
export const achievementsSeasonal: MongoMigration = {
  id: '0043_achievements_seasonal',
  async up(db) {
    await ensureCollection(db, ACHIEVEMENTS_COLLECTIONS.seasonGrants);
    const { key, options } = ACHIEVEMENT_SEASON_INDEXES.userCodeSeasonUnique;
    await db.collection(ACHIEVEMENTS_COLLECTIONS.seasonGrants).createIndex(key, options);
  },
};
