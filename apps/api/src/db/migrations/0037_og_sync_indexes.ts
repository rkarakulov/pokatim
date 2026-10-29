import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { CALENDAR_COLLECTIONS } from '../../modules/calendar/calendar.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

const OG_SYNC_KEY = { status: 1, updatedAt: 1, _id: 1 } as const;

/**
 * Пререндер OG-картинок (`og.sync`, og-images): ежеминутный keyset «изменилось после `(updatedAt, _id)`» по
 * публичным объектам каждого вида — без полного просмотра и сортировки в памяти.
 */
export const OG_SYNC_INDEXES = {
  races: { key: OG_SYNC_KEY, options: { name: 'races_og_sync_idx' } },
  rides: { key: OG_SYNC_KEY, options: { name: 'rides_og_sync_idx' } },
  routes: { key: OG_SYNC_KEY, options: { name: 'routes_og_sync_idx' } },
  calendar: { key: OG_SYNC_KEY, options: { name: 'calendar_starts_og_sync_idx' } },
} as const satisfies Record<string, IndexDef>;

/**
 * Индексы пререндера OG-картинок (og-images). Expand-only, без транзакции и бэкфилла, идемпотентна. После
 * `0036_overview_indexes`.
 */
export const ogSyncIndexes: MongoMigration = {
  id: '0037_og_sync_indexes',
  async up(db) {
    const target = {
      races: RACES_COLLECTIONS.races,
      rides: RIDES_COLLECTIONS.rides,
      routes: ROUTES_COLLECTIONS.routes,
      calendar: CALENDAR_COLLECTIONS.starts,
    } as const;
    for (const [name, { key, options }] of Object.entries(OG_SYNC_INDEXES)) {
      await db.collection(target[name as keyof typeof target]).createIndex(key, options);
    }
  },
};
