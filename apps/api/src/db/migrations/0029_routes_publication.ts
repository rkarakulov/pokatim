import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { ROUTE_REPORTS_COLLECTIONS } from '../../modules/routes/route-reports.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы публикации маршрутов райдеров (routes-06): одна жалоба на (маршрут, пользователь) — и `reported` зрителя;
 * жалобы карточки модерации (100 новых по `_id`), закрытие, агрегация причин и удаление с маршрутом — префикс
 * `routeId`. Очереди — частичные индексы `routes` (запрос очереди обязан содержать условие частичного фильтра).
 */
export const ROUTES_PUBLICATION_INDEXES: Record<string, IndexDef[]> = {
  [ROUTE_REPORTS_COLLECTIONS.reports]: [
    {
      key: { routeId: 1, reporterUserId: 1 },
      options: { name: 'route_reports_route_reporter_unique', unique: true },
    },
    { key: { routeId: 1, _id: -1 }, options: { name: 'route_reports_route_idx' } },
  ],
  [ROUTES_COLLECTIONS.routes]: [
    {
      key: { 'publication.submittedAt': 1, _id: 1 },
      options: {
        name: 'routes_publication_pending_idx',
        partialFilterExpression: { 'publication.status': 'pending' },
      },
    },
    {
      key: { 'publication.lastReportAt': -1, _id: -1 },
      options: {
        name: 'routes_publication_reports_idx',
        partialFilterExpression: { 'publication.openReportCount': { $gt: 0 } },
      },
    },
    {
      key: { 'publication.hiddenAt': -1, _id: -1 },
      options: {
        name: 'routes_publication_hidden_idx',
        partialFilterExpression: { 'publication.status': 'hidden' },
      },
    },
  ],
};

/**
 * Публикация маршрутов райдеров в каталог (routes-06): коллекция `route_reports` и индексы жалоб и очередей.
 * Expand-only, без транзакции, идемпотентна; бэкфилла нет — нет `routes.publication` значит «не подавался» (`?? null`).
 */
export const routesPublication: MongoMigration = {
  id: '0029_routes_publication',
  async up(db) {
    for (const [name, indexes] of Object.entries(ROUTES_PUBLICATION_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
