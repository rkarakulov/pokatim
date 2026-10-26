import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Протокол гонки (race-results-05), коллекции только вставок: исключения и возвраты треков (по гонке и попытке —
 * последняя запись попытки, RC-10), снимок протокола по ревизиям (участник и порядок уникальны в ревизии), журнал
 * пересчётов (ревизия уникальна в гонке — частичный индекс по числовой ревизии, `recheck_started` без ревизии, RC-2).
 */
export const PROTOCOL_INDEXES: Record<string, IndexDef[]> = {
  [RESULTS_COLLECTIONS.reviews]: [
    { key: { raceId: 1, _id: 1 }, options: { name: 'race_attempt_reviews_race_idx' } },
    { key: { attemptId: 1, _id: 1 }, options: { name: 'race_attempt_reviews_attempt_idx' } },
  ],
  [RESULTS_COLLECTIONS.protocolRows]: [
    {
      key: { raceId: 1, revision: 1, entryId: 1 },
      options: { name: 'race_protocol_rows_unique', unique: true },
    },
    {
      key: { raceId: 1, revision: 1, order: 1 },
      options: { name: 'race_protocol_rows_order_unique', unique: true },
    },
  ],
  [RESULTS_COLLECTIONS.recalculations]: [
    { key: { raceId: 1, _id: 1 }, options: { name: 'race_recalculations_race_idx' } },
    {
      key: { raceId: 1, revision: 1 },
      options: {
        name: 'race_recalculations_revision_unique',
        unique: true,
        partialFilterExpression: { revision: { $type: 'number' } },
      },
    },
  ],
};

/**
 * Протокол гонки: коллекции и индексы `race_attempt_reviews`, `race_protocol_rows`, `race_recalculations`; бэкфилл
 * `races.protocolPublishedAt = null` (чтение терпит отсутствие поля). Expand-only, без транзакции, идемпотентна.
 */
export const protocol: MongoMigration = {
  id: '0016_protocol',
  async up(db) {
    for (const [name, indexes] of Object.entries(PROTOCOL_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection(RACES_COLLECTIONS.races)
      .updateMany(
        { protocolPublishedAt: { $exists: false } },
        { $set: { protocolPublishedAt: null } },
      );
  },
};
