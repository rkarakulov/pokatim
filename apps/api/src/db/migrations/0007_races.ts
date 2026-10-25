import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS, type RaceMetaDoc } from '../../modules/races/races.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Индексы сезонов и гонок: публичные списки, сезон по концу окна, панель (свои и все). */
export const RACES_INDEXES: Record<string, IndexDef[]> = {
  [RACES_COLLECTIONS.seasons]: [
    { key: { startsAt: 1 }, options: { name: 'seasons_starts_at_idx' } },
  ],
  [RACES_COLLECTIONS.races]: [
    {
      key: { status: 1, windowStartsAt: 1, _id: 1 },
      options: { name: 'races_public_current_idx' },
    },
    {
      key: { status: 1, windowEndsAt: -1, _id: -1 },
      options: { name: 'races_public_past_idx' },
    },
    { key: { seasonId: 1, windowEndsAt: 1 }, options: { name: 'races_season_idx' } },
    {
      key: { ownerUserId: 1, windowStartsAt: -1, _id: -1 },
      options: { name: 'races_owner_idx' },
    },
    { key: { windowStartsAt: -1, _id: -1 }, options: { name: 'races_panel_idx' } },
  ],
  [RACES_COLLECTIONS.meta]: [],
};

/**
 * Сезоны и гонки (admin-02): коллекции, индексы, документ-замок расписания `race_meta.schedule`. Expand-only, без
 * транзакции, идемпотентна (повторный `up` не сбрасывает версию замка).
 */
export const races: MongoMigration = {
  id: '0007_races',
  async up(db) {
    for (const [name, indexes] of Object.entries(RACES_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection<RaceMetaDoc>(RACES_COLLECTIONS.meta)
      .updateOne({ _id: 'schedule' }, { $setOnInsert: { version: 0 } }, { upsert: true });
  },
};
