import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTE_RIDES_COLLECTIONS } from '../../modules/route-rides/route-rides.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Засчитанные заезды по моменту итога (achievements-push N2): источник серверной сверки достижений
 * `RIDER_ROUTE_RIDES.passedRidersAfter` — keyset `(checkedAt, _id)` только по `passed` (частичный индекс: зависшие и
 * незасчитанные в него не входят).
 */
export const ROUTE_RIDES_PASSED_INDEX = {
  key: { checkedAt: 1, _id: 1 },
  options: {
    name: 'route_rides_passed_checked_idx',
    partialFilterExpression: { status: 'passed' },
  },
} as const satisfies IndexDef;

/**
 * Индекс засчитанных заездов по маршруту (achievements-push N2). Только expand: коллекция и прежний индекс не
 * трогаются; без транзакции, без бэкфилла, идемпотентна. После `0043_achievements_seasonal`.
 */
export const routeRidesPassedIdx: MongoMigration = {
  id: '0044_route_rides_passed_idx',
  async up(db) {
    const { key, options } = ROUTE_RIDES_PASSED_INDEX;
    await db.collection(ROUTE_RIDES_COLLECTIONS.rides).createIndex(key, options);
  },
};
