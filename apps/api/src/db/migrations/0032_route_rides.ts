import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTE_RIDES_COLLECTIONS } from '../../modules/route-rides/route-rides.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индекс заездов по маршруту (route-rides-01): уникальный `(userId, routeId, activityId)` — дедупликация параллельного
 * POST одной группы дублей; префикс обслуживает список и квоту `(userId, routeId)` и стирание `{ userId }`.
 */
export const ROUTE_RIDES_INDEXES: Record<string, IndexDef[]> = {
  [ROUTE_RIDES_COLLECTIONS.rides]: [
    {
      key: { userId: 1, routeId: 1, activityId: 1 },
      options: { name: 'route_rides_user_route_activity_unique', unique: true },
    },
  ],
};

/**
 * Заезды по маршруту (route-rides-01): коллекция `route_rides` и индекс. Expand-only, без транзакции, идемпотентна;
 * бэкфилла нет; после `0031_rides_geo`.
 */
export const routeRides: MongoMigration = {
  id: '0032_route_rides',
  async up(db) {
    for (const [name, indexes] of Object.entries(ROUTE_RIDES_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) await db.collection(name).createIndex(key, options);
    }
  },
};
