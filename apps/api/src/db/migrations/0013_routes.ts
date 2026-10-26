import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы маршрутов (race-results-01): дедуп загрузки (тот же файл того же сотрудника), список готовых маршрутов
 * платформы и свои маршруты сотрудника — новые сверху. Геометрия и исходник — без вторичных индексов (чтение по `_id`).
 */
export const ROUTES_INDEXES: Record<string, IndexDef[]> = {
  [ROUTES_COLLECTIONS.routes]: [
    {
      key: { ownerUserId: 1, sha256: 1 },
      options: { name: 'routes_owner_sha_unique', unique: true },
    },
    { key: { origin: 1, status: 1, _id: -1 }, options: { name: 'routes_list_idx' } },
    { key: { ownerUserId: 1, _id: -1 }, options: { name: 'routes_owner_idx' } },
  ],
  [ROUTES_COLLECTIONS.geometries]: [],
  [ROUTES_COLLECTIONS.sources]: [],
};

/**
 * Маршруты и коридор гонки: коллекции и индексы `routes`, бэкфилл `races.corridor = null` (чтение терпит отсутствие
 * поля). Expand-only, без транзакции, идемпотентна.
 */
export const routes: MongoMigration = {
  id: '0013_routes',
  async up(db) {
    for (const [name, indexes] of Object.entries(ROUTES_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection(RACES_COLLECTIONS.races)
      .updateMany({ corridor: { $exists: false } }, { $set: { corridor: null } });
  },
};
