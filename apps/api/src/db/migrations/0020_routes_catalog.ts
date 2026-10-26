import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы каталога маршрутов (routes-01): список опубликованных маршрутов — новые публикации сверху (частичный:
 * запрос каталога обязан содержать `'catalog.publishedAt': { $type: 'date' }`); гонки маршрута — новые окна сверху
 * (без частичного фильтра: равенство по строке не доказывает `$type`).
 */
export const ROUTES_CATALOG_INDEXES: Record<string, IndexDef[]> = {
  [ROUTES_COLLECTIONS.routes]: [
    {
      key: { 'catalog.publishedAt': -1, _id: -1 },
      options: {
        name: 'routes_catalog_idx',
        partialFilterExpression: { 'catalog.publishedAt': { $type: 'date' } },
      },
    },
  ],
  [RACES_COLLECTIONS.races]: [
    {
      key: { 'corridor.routeId': 1, windowStartsAt: -1, _id: -1 },
      options: { name: 'races_route_idx' },
    },
  ],
};

/**
 * Каталог маршрутов: индексы и бэкфилл `routes.catalog = null` (чтение всё равно терпит отсутствие поля — `?? null`).
 * Expand-only, без транзакции, идемпотентна.
 */
export const routesCatalog: MongoMigration = {
  id: '0020_routes_catalog',
  async up(db) {
    for (const [name, indexes] of Object.entries(ROUTES_CATALOG_INDEXES)) {
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    await db
      .collection(ROUTES_COLLECTIONS.routes)
      .updateMany({ catalog: { $exists: false } }, { $set: { catalog: null } });
  },
};
