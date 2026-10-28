import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { STANDINGS_COLLECTIONS } from '../../modules/standings/standings.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы рейтинга сезона (race-results-08): страница таблицы и замена строк сезона — уникальный
 * `(seasonId, bikeClass, groupKey, order)` (префикс `seasonId` — `deleteMany`), свои строки (`/me`) —
 * `(seasonId, userId)`; регламент читает гонки с протоколом всех сезонов — частичный индекс `races` (RC-4: запрос
 * обязан содержать ровно `protocolPublishedAt: { $type: 'date' }`).
 */
export const STANDINGS_INDEXES: Record<string, IndexDef[]> = {
  [STANDINGS_COLLECTIONS.rows]: [
    {
      key: { seasonId: 1, bikeClass: 1, groupKey: 1, order: 1 },
      options: { name: 'season_standing_rows_order_unique', unique: true },
    },
    { key: { seasonId: 1, userId: 1 }, options: { name: 'season_standing_rows_user_idx' } },
  ],
  [RACES_COLLECTIONS.races]: [
    {
      key: { seasonId: 1, windowEndsAt: 1, _id: 1 },
      options: {
        name: 'races_protocol_idx',
        partialFilterExpression: { protocolPublishedAt: { $type: 'date' } },
      },
    },
  ],
};

/**
 * Рейтинг сезона (race-results-08): коллекции снимка `season_standings`, `season_standing_rows` и индексы.
 * Expand-only, без транзакции, идемпотентна. Бэкфилла нет — первый прогон регламента `standings.sync` после выката
 * строит снимки всех сезонов с протоколами.
 */
export const standings: MongoMigration = {
  id: '0030_standings',
  async up(db) {
    await ensureCollection(db, STANDINGS_COLLECTIONS.seasons);
    for (const [name, indexes] of Object.entries(STANDINGS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) await db.collection(name).createIndex(key, options);
    }
  },
};
