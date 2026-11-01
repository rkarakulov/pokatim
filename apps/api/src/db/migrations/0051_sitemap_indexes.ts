import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { CALENDAR_COLLECTIONS } from '../../modules/calendar/calendar.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

const SITEMAP_KEY = { status: 1, _id: 1, updatedAt: 1 } as const;

/**
 * Карта сайта (sitemap-index): keyset публичных объектов по `_id` ↑ (`sitemapAfter` репозиториев) — без `SORT`;
 * у гонок и стартов покрывающий (`_id`, `updatedAt` из индекса), у маршрутов условия каталога — по документу.
 * Сезоны — по `_id_`.
 */
export const SITEMAP_INDEXES = {
  races: { key: SITEMAP_KEY, options: { name: 'races_sitemap_idx' } },
  routes: { key: SITEMAP_KEY, options: { name: 'routes_sitemap_idx' } },
  calendar: { key: SITEMAP_KEY, options: { name: 'calendar_starts_sitemap_idx' } },
} as const satisfies Record<string, IndexDef>;

/**
 * Индексы карты сайта (sitemap-index). Только expand: коллекции и прежние индексы не трогаются; без транзакции, без
 * бэкфилла, идемпотентна. После `0050_social_home`.
 */
export const sitemapIndexes: MongoMigration = {
  id: '0051_sitemap_indexes',
  async up(db) {
    const target = {
      races: RACES_COLLECTIONS.races,
      routes: ROUTES_COLLECTIONS.routes,
      calendar: CALENDAR_COLLECTIONS.starts,
    } as const;
    for (const [name, { key, options }] of Object.entries(SITEMAP_INDEXES)) {
      await db.collection(target[name as keyof typeof target]).createIndex(key, options);
    }
  },
};
