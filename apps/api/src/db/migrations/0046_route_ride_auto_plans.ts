import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTE_RIDES_COLLECTIONS } from '../../modules/route-rides/route-rides.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Планы автопроверки заездов по маршруту (route-rides-03, ревью pass 3): уборка по `expiresAt` (TTL; срок плана
 * проверяет сервер), стирание аккаунта — по `userId`.
 */
export const ROUTE_RIDE_AUTO_PLANS_INDEXES = [
  {
    key: { expiresAt: 1 },
    options: { name: 'route_ride_auto_plans_expires_ttl', expireAfterSeconds: 0 },
  },
  { key: { userId: 1 }, options: { name: 'route_ride_auto_plans_user_idx' } },
] as const satisfies readonly IndexDef[];

/** Коллекция планов автопроверки. Только expand, без бэкфилла, идемпотентна. После `0045_social`. */
export const routeRideAutoPlans: MongoMigration = {
  id: '0046_route_ride_auto_plans',
  async up(db) {
    await ensureCollection(db, ROUTE_RIDES_COLLECTIONS.autoPlans);
    for (const { key, options } of ROUTE_RIDE_AUTO_PLANS_INDEXES) {
      await db.collection(ROUTE_RIDES_COLLECTIONS.autoPlans).createIndex(key, options);
    }
  },
};
