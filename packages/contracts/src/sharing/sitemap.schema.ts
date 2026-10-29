import { z } from 'zod';

import { Uuid } from '../common.ts';

/**
 * Карта сайта (landing-seo): публичные индексируемые объекты для `sitemap.xml` web-сервера. Профили райдеров и
 * кофе-райды не входят — их страницы всегда `noindex`. Виды — только в конец.
 */
export const SITEMAP_KINDS = ['race', 'season', 'route', 'calendar'] as const;
export const SitemapKind = z.enum(SITEMAP_KINDS);
export type SitemapKind = z.infer<typeof SitemapKind>;

export const SitemapEntry = z.object({
  kind: SitemapKind,
  id: Uuid,
  /** последнее изменение объекта (UTC) — `lastmod` */
  updatedAt: z.iso.datetime(),
});
export type SitemapEntry = z.infer<typeof SitemapEntry>;

/** `GET /v1/sitemap` — без входа, только опубликованное. */
export const SitemapEntries = z.object({ items: z.array(SitemapEntry) });
export type SitemapEntries = z.infer<typeof SitemapEntries>;
