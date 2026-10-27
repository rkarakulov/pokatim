import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';
import { ensureCollection } from './0002_identity';

/**
 * Производные данные маршрута (routes-03): коллекция очищенного GPX `route_exports` (чтение по `_id`, без вторичных
 * индексов) и индекс выборки бэкфилла `route_geometries_derived_idx { derivedVersion: 1 }` (не частичный: «нет поля
 * или меньше версии» частичным фильтром не выражается; без него регламент читал бы с диска все геометрии до ~1 МБ).
 * Expand-only, без транзакции, идемпотентна; данные досчитывает регламент `routes-maintenance`, не миграция.
 */
export const routesDerived: MongoMigration = {
  id: '0022_routes_derived',
  async up(db) {
    await ensureCollection(db, ROUTES_COLLECTIONS.exports);
    await db
      .collection(ROUTES_COLLECTIONS.geometries)
      .createIndex({ derivedVersion: 1 }, { name: 'route_geometries_derived_idx' });
  },
};
