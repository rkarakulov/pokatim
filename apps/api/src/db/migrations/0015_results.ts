import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы заявок и попыток (race-results-03): одна заявка на (гонку, райдера), активные заявки пользователя, места
 * при чтении (частичный — активные с лучшим), счётчики гонки; одна попытка на (гонку, активность), попытки заявки,
 * активности, панели и зависшие проверки.
 */
export const RESULTS_INDEXES: Record<string, IndexDef[]> = {
  [RESULTS_COLLECTIONS.entries]: [
    {
      key: { raceId: 1, userId: 1 },
      options: { name: 'race_entries_race_user_unique', unique: true },
    },
    { key: { userId: 1, status: 1 }, options: { name: 'race_entries_user_idx' } },
    {
      key: { raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
      options: {
        name: 'race_entries_ranking_idx',
        partialFilterExpression: { status: 'active', best: { $type: 'object' } },
      },
    },
    { key: { raceId: 1, status: 1 }, options: { name: 'race_entries_race_idx' } },
  ],
  [RESULTS_COLLECTIONS.attempts]: [
    {
      key: { raceId: 1, activityId: 1 },
      options: { name: 'race_attempts_race_activity_unique', unique: true },
    },
    { key: { entryId: 1, _id: -1 }, options: { name: 'race_attempts_entry_idx' } },
    { key: { activityId: 1 }, options: { name: 'race_attempts_activity_idx' } },
    {
      key: { raceId: 1, status: 1, _id: -1 },
      options: { name: 'race_attempts_race_status_idx' },
    },
    {
      key: { status: 1, updatedAt: 1 },
      options: {
        name: 'race_attempts_stuck_idx',
        partialFilterExpression: { status: { $in: ['queued', 'checking'] } },
      },
    },
  ],
};

/**
 * Заявки и попытки гонок: коллекции и индексы `race_entries`/`race_attempts`, бэкфилл `races.lockedAt = null` (чтение
 * терпит отсутствие поля). Expand-only, без транзакции, идемпотентна. Номер `0015`: `0014` занимают кофе-райды
 * (коллекции не пересекаются, порядок применения не важен).
 */
export const results: MongoMigration = {
  id: '0015_results',
  async up(db) {
    for (const [name, indexes] of Object.entries(RESULTS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection(RACES_COLLECTIONS.races)
      .updateMany({ lockedAt: { $exists: false } }, { $set: { lockedAt: null } });
  },
};
