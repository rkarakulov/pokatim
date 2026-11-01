import { SitemapIndex } from '@pokatim/contracts';

import { ogOrigin } from '@/lib/og-image';
import { fetchPublicForSsr } from '@/lib/public-ssr';
import { sitemapIndexXml } from '@/lib/seo';
import { sitemapNotFound, sitemapResponse, sitemapUnavailable } from '@/lib/sitemap-route';

/**
 * `sitemap.xml` (landing-seo, sitemap-index) — sitemap index: `sitemap/static.xml` и страницы видов `GET /v1/sitemap`
 * (`sitemap/<kind>/<n>.xml`). Нет `WEB_ORIGIN` — `404`; API недоступен — `503` + `Retry-After`.
 */
export async function GET(): Promise<Response> {
  const origin = ogOrigin();
  if (!origin) return sitemapNotFound();
  const index = await fetchPublicForSsr('/v1/sitemap', SitemapIndex);
  if (index.status !== 'found') return sitemapUnavailable();
  return sitemapResponse(sitemapIndexXml(origin, index.data.pages));
}
