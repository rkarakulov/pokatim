import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { DISPUTES_COLLECTIONS } from '../../modules/disputes/disputes.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы споров (race-results-06, RC-11): один спор на (гонка, заявитель, цель) — и «мои споры», и лимит открытых
 * (префикс); D-39 и «по моему результату» — по цели; чек-лист, D-19 и список панели по гонке; очередь панели по
 * статусу; все споры. История — по `(disputeId, at, _id)` (`uuidv7` не монотонен внутри миллисекунды).
 */
export const DISPUTES_INDEXES: Record<string, IndexDef[]> = {
  [DISPUTES_COLLECTIONS.disputes]: [
    {
      key: { raceId: 1, complainantUserId: 1, targetEntryId: 1 },
      options: { name: 'disputes_pair_unique', unique: true },
    },
    { key: { targetEntryId: 1, status: 1 }, options: { name: 'disputes_target_idx' } },
    {
      key: { raceId: 1, status: 1, filedAt: -1, _id: -1 },
      options: { name: 'disputes_race_idx' },
    },
    { key: { status: 1, filedAt: -1, _id: -1 }, options: { name: 'disputes_queue_idx' } },
    { key: { filedAt: -1, _id: -1 }, options: { name: 'disputes_all_idx' } },
  ],
  [DISPUTES_COLLECTIONS.events]: [
    { key: { disputeId: 1, at: 1, _id: 1 }, options: { name: 'dispute_events_dispute_idx' } },
  ],
};

/**
 * Споры (race-results-06): коллекции `disputes`, `dispute_events` и их индексы; бэкфилл `race_entries.disqualified`
 * и `races.disputeFilingClosedAt` = `null` у документов без поля (`$exists: false` — идемпотентно; чтение всё равно
 * терпит отсутствие). Expand-only, без транзакции. Частичный `race_entries_ranking_idx` остаётся пригодным:
 * `disqualified: null` — остаточный фильтр.
 */
export const disputes: MongoMigration = {
  id: '0018_disputes',
  async up(db) {
    for (const [name, indexes] of Object.entries(DISPUTES_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection(RESULTS_COLLECTIONS.entries)
      .updateMany({ disqualified: { $exists: false } }, { $set: { disqualified: null } });
    await db
      .collection(RACES_COLLECTIONS.races)
      .updateMany(
        { disputeFilingClosedAt: { $exists: false } },
        { $set: { disputeFilingClosedAt: null } },
      );
  },
};
