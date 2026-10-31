import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTE_RIDES_COLLECTIONS } from '../../modules/route-rides/route-rides.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Таблица «Другие» маршрута (route-rides-04): засчитанные заезды маршрута в порядке ключа ранжирования
 * (`compareRides`: время сегмента ↑, дата заезда ↑, `_id` ↑) — агрегат `RouteRidesRepository.leaderboardTop`
 * (`$match` по `routeId` + `passed`, `$group` с `$topN`). Частичный по `passed`: незасчитанные в него не входят.
 */
export const ROUTE_RIDES_LEADERBOARD_INDEX = {
  key: { routeId: 1, 'segment.elapsedSec': 1, 'activity.startedAt': 1, _id: 1 },
  options: {
    name: 'route_rides_leaderboard_idx',
    partialFilterExpression: { status: 'passed' },
  },
} as const satisfies IndexDef;

/**
 * Индекс таблицы «Другие» (route-rides-04). Только expand: коллекция и прежние индексы не трогаются; без транзакции,
 * без бэкфилла, идемпотентна. После `0046_route_ride_auto_plans`.
 */
export const routeRidesLeaderboardIdx: MongoMigration = {
  id: '0047_route_rides_leaderboard_idx',
  async up(db) {
    const { key, options } = ROUTE_RIDES_LEADERBOARD_INDEX;
    await db.collection(ROUTE_RIDES_COLLECTIONS.rides).createIndex(key, options);
  },
};
