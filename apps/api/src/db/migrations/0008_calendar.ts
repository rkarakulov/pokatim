import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { CALENDAR_COLLECTIONS } from '../../modules/calendar/calendar.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Индексы календаря: публичный список по дате, фильтр города, панель (новые даты сверху). */
export const CALENDAR_INDEXES: IndexDef[] = [
  { key: { status: 1, startsOn: 1, _id: 1 }, options: { name: 'calendar_starts_public_idx' } },
  { key: { status: 1, cityKey: 1, startsOn: 1 }, options: { name: 'calendar_starts_city_idx' } },
  { key: { startsOn: -1, _id: -1 }, options: { name: 'calendar_starts_panel_idx' } },
];

/** Календарь стартов (admin-02): коллекция и индексы. Expand-only, без транзакции, идемпотентна. */
export const calendar: MongoMigration = {
  id: '0008_calendar',
  async up(db) {
    await ensureCollection(db, CALENDAR_COLLECTIONS.starts);
    for (const { key, options } of CALENDAR_INDEXES) {
      await db.collection(CALENDAR_COLLECTIONS.starts).createIndex(key, options);
    }
  },
};
