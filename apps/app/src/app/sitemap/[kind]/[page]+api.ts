import { SitemapPage } from '@pokatim/contracts';

import { ogOrigin } from '@/lib/og-image';
import { fetchPublicForSsr } from '@/lib/public-ssr';
import { parseSitemapPagePath, sitemapPageXml } from '@/lib/seo';
import { sitemapNotFound, sitemapResponse, sitemapUnavailable } from '@/lib/sitemap-route';

/**
 * `sitemap/<kind>/<n>.xml` (sitemap-index) — страница вида `GET /v1/sitemap/:kind/:page`. Expo Router: динамический —
 * только весь сегмент, поэтому `[page]` = `<n>.xml` разбирается здесь; чужой вид или имя — `404` без запроса к API.
 * Страницы нет в индексе API — `404`; API недоступен — `503` + `Retry-After`; нет `WEB_ORIGIN` — `404`.
 */
export async function GET(
  _request: Request,
  params: { kind?: string; page?: string },
): Promise<Response> {
  const origin = ogOrigin();
  if (!origin) return sitemapNotFound();
  const target = parseSitemapPagePath(params.kind, params.page);
  if (!target) return sitemapNotFound();
  const page = await fetchPublicForSsr(`/v1/sitemap/${target.kind}/${target.page}`, SitemapPage);
  if (page.status === 'notFound') return sitemapNotFound();
  if (page.status !== 'found') return sitemapUnavailable();
  return sitemapResponse(sitemapPageXml(origin, target.kind, page.data.items));
}
