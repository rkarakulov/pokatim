import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Прежний индекс мест `0015_results` (без уровня и `best.ranked`) — удаляется (решение автора 2026-10-27). */
export const LEGACY_RANKING_INDEX = 'race_entries_ranking_idx';

/**
 * Индексы race-results-07: места по группе (Verified с местом), финишёры (время без места), строки протокола по
 * группе.
 */
export const ENTRY_TIER_INDEXES: Record<string, IndexDef[]> = {
  [RESULTS_COLLECTIONS.entries]: [
    {
      key: { raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
      options: {
        name: 'race_entries_ranked_idx',
        partialFilterExpression: {
          status: 'active',
          best: { $type: 'object' },
          tier: 'verified',
          'best.ranked': true,
        },
      },
    },
    {
      key: { raceId: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 },
      options: {
        name: 'race_entries_finishers_idx',
        partialFilterExpression: {
          status: 'active',
          best: { $type: 'object' },
          'best.ranked': false,
        },
      },
    },
  ],
  [RESULTS_COLLECTIONS.protocolRows]: [
    {
      key: { raceId: 1, revision: 1, groupKey: 1, order: 1 },
      options: { name: 'race_protocol_rows_group_idx' },
    },
  ],
};

/**
 * Уровни заявки и группы зачёта (race-results-07): бэкфилл `race_entries.tier: null → 'verified'` и `best.ranked =
 * true` (заявки до 07 — Verified в схеме `overall`, места как в v1), `races.groupScheme` (`overall` — гонкам с
 * `lockedAt`, явный `null` — остальным), коллекция анкет `rider_verified_profiles`, новые индексы, **затем** удаление
 * `race_entries_ranking_idx` (решение автора 2026-10-27, образец `0021`). Опубликованные протоколы не меняются.
 * Без транзакции, идемпотентна. Порядок деплоя — миграция → API и worker вместе (RC-7).
 */
export const entryTier: MongoMigration = {
  id: '0028_entry_tier',
  async up(db) {
    const entries = db.collection(RESULTS_COLLECTIONS.entries);
    const races = db.collection(RACES_COLLECTIONS.races);
    await entries.updateMany({ tier: null }, { $set: { tier: 'verified' } });
    await entries.updateMany(
      { best: { $type: 'object' }, 'best.ranked': { $exists: false } },
      { $set: { 'best.ranked': true } },
    );
    await races.updateMany(
      { lockedAt: { $type: 'date' }, groupScheme: { $exists: false } },
      { $set: { groupScheme: 'overall' } },
    );
    await races.updateMany({ groupScheme: { $exists: false } }, { $set: { groupScheme: null } });
    await ensureCollection(db, PROFILE_COLLECTIONS.verified);
    for (const [name, indexes] of Object.entries(ENTRY_TIER_INDEXES)) {
      for (const { key, options } of indexes) await db.collection(name).createIndex(key, options);
    }
    if (await entries.indexExists(LEGACY_RANKING_INDEX))
      await entries.dropIndex(LEGACY_RANKING_INDEX);
  },
};
