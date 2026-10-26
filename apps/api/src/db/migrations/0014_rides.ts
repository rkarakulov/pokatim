import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы кофе-райдов: лента по времени старта (и по городу), участник (отменённые свои в ленте, квота отметок,
 * будущее удаление аккаунта — multikey), организатор (квота, удаление аккаунта).
 */
export const RIDES_INDEXES: IndexDef[] = [
  { key: { startsAt: 1, _id: 1 }, options: { name: 'rides_feed_idx' } },
  { key: { cityCode: 1, startsAt: 1, _id: 1 }, options: { name: 'rides_city_feed_idx' } },
  { key: { 'participants.userId': 1, startsAt: 1 }, options: { name: 'rides_participant_idx' } },
  { key: { organizerUserId: 1, startsAt: -1 }, options: { name: 'rides_organizer_idx' } },
];

/** Кофе-райды (app-05): коллекция и индексы. Expand-only, без транзакции, идемпотентна; после `0013_routes`. */
export const rides: MongoMigration = {
  id: '0014_rides',
  async up(db) {
    await ensureCollection(db, RIDES_COLLECTIONS.rides);
    for (const { key, options } of RIDES_INDEXES) {
      await db.collection(RIDES_COLLECTIONS.rides).createIndex(key, options);
    }
  },
};
