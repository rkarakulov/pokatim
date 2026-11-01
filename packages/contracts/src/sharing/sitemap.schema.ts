import { z } from 'zod';

import { Uuid } from '../common.ts';

/**
 * Карта сайта (landing-seo, sitemap-index): публичные индексируемые объекты для `sitemap.xml` web-сервера. Профили
 * райдеров и кофе-райды не входят — их страницы всегда `noindex`. Виды — только в конец.
 */
export const SITEMAP_KINDS = ['race', 'season', 'route', 'calendar'] as const;
export const SitemapKind = z.enum(SITEMAP_KINDS);
export type SitemapKind = z.infer<typeof SitemapKind>;

/** Номер страницы вида в пути: с 1, без ведущих нулей, до 6 цифр. */
const SITEMAP_PAGE_IN_PATH = /^[1-9]\d{0,5}$/;

/** Страница вида в индексе: `updatedAt` — последнее изменение объектов страницы (UTC), `lastmod` дочерней карты. */
export const SitemapIndexPage = z.object({
  kind: SitemapKind,
  page: z.int().min(1),
  updatedAt: z.iso.datetime(),
});
export type SitemapIndexPage = z.infer<typeof SitemapIndexPage>;

/** `GET /v1/sitemap` — индекс: страницы видов по `_id` ↑, без входа, только опубликованное. */
export const SitemapIndex = z.object({ pages: z.array(SitemapIndexPage) });
export type SitemapIndex = z.infer<typeof SitemapIndex>;

export const SitemapPageEntry = z.object({
  id: Uuid,
  /** последнее изменение объекта (UTC) — `lastmod` */
  updatedAt: z.iso.datetime(),
});
export type SitemapPageEntry = z.infer<typeof SitemapPageEntry>;

/** `GET /v1/sitemap/:kind/:page` — объекты страницы вида по `_id` ↑. */
export const SitemapPage = z.object({ items: z.array(SitemapPageEntry) });
export type SitemapPage = z.infer<typeof SitemapPage>;

/** Параметры пути `GET /v1/sitemap/:kind/:page`: номер — строка пути → число. */
export const SitemapPageParams = z.object({
  kind: SitemapKind,
  page: z.string().regex(SITEMAP_PAGE_IN_PATH).transform(Number),
});
export type SitemapPageParams = z.output<typeof SitemapPageParams>;
