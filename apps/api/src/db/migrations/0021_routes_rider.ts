import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Прежний индекс дедупа `(ownerUserId, sha256)` из `0013_routes` — пересекал маршруты платформы и райдера. */
export const LEGACY_ROUTES_OWNER_SHA_INDEX = 'routes_owner_sha_unique';

/**
 * Маршруты райдера (routes-02): дедуп загрузки — в пределах происхождения (сотрудник, загрузивший файл маршрута
 * команды в приложении, получает свой маршрут райдера); список своих маршрутов — новые сверху.
 */
export const ROUTES_RIDER_INDEXES: IndexDef[] = [
  {
    key: { ownerUserId: 1, origin: 1, sha256: 1 },
    options: { name: 'routes_owner_origin_sha_unique', unique: true },
  },
  { key: { ownerUserId: 1, origin: 1, _id: -1 }, options: { name: 'routes_owner_origin_idx' } },
];

/**
 * Новые индексы, **затем** удаление `routes_owner_sha_unique` (подтверждено человеком, HG-1, 2026-10-27): для
 * `platform` новый уникальный индекс эквивалентен старому и создаётся до удаления. Данные не меняются (`origin` есть
 * у всех документов с `0013_routes`). Без транзакции, идемпотентна. Порядок деплоя — миграция → API.
 */
export const routesRider: MongoMigration = {
  id: '0021_routes_rider',
  async up(db) {
    const routes = db.collection(ROUTES_COLLECTIONS.routes);
    for (const { key, options } of ROUTES_RIDER_INDEXES) await routes.createIndex(key, options);
    if (await routes.indexExists(LEGACY_ROUTES_OWNER_SHA_INDEX)) {
      await routes.dropIndex(LEGACY_ROUTES_OWNER_SHA_INDEX);
    }
  },
};
