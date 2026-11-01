import { SitemapIndex, SitemapPage } from '@pokatim/contracts';

import { ogOrigin } from '@/lib/og-image';
import { fetchPublicForSsr } from '@/lib/public-ssr';
import { parseSitemapQuery, sitemapIndexXml, sitemapPageXml, staticSitemapXml } from '@/lib/seo';
import { sitemapNotFound, sitemapResponse, sitemapUnavailable } from '@/lib/sitemap-route';

/**
 * `sitemap.xml` (landing-seo, sitemap-index) — индекс и дочерние карты в корне сайта (`parseSitemapQuery`): без query
 * — sitemap index (`GET /v1/sitemap`), `?kind=static` — лендинг без API, `?kind=<вид>&page=<n>` — страница вида
 * (`GET /v1/sitemap/:kind/:page`; нет в индексе API — `404`). Неверный query — `404` без запроса к API; нет
 * `WEB_ORIGIN` — `404`; API недоступен — `503` + `Retry-After`.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = ogOrigin();
  if (!origin) return sitemapNotFound();
  const target = parseSitemapQuery(new URL(request.url).searchParams);
  if (!target) return sitemapNotFound();
  if (target.type === 'static') return sitemapResponse(staticSitemapXml(origin));
  if (target.type === 'index') {
    const index = await fetchPublicForSsr('/v1/sitemap', SitemapIndex);
    if (index.status !== 'found') return sitemapUnavailable();
    return sitemapResponse(sitemapIndexXml(origin, index.data.pages));
  }
  const page = await fetchPublicForSsr(`/v1/sitemap/${target.kind}/${target.page}`, SitemapPage);
  if (page.status === 'notFound') return sitemapNotFound();
  if (page.status !== 'found') return sitemapUnavailable();
  return sitemapResponse(sitemapPageXml(origin, target.kind, page.data.items));
}
