import { SitemapEntries } from '@pokatim/contracts';

import { ogOrigin } from '@/lib/og-image';
import { fetchPublicForSsr } from '@/lib/public-ssr';
import { sitemapXml } from '@/lib/seo';

/**
 * `sitemap.xml` (landing-seo): лендинг и публичные объекты `GET /v1/sitemap` (кэш процесса 60 с, у API — мемо 10 мин).
 * Нет `WEB_ORIGIN` — `404` (адреса карты только абсолютные); API недоступен — `503` + `Retry-After`: краулер повторит
 * и не выкинет URL из индекса.
 */
export async function GET(): Promise<Response> {
  const origin = ogOrigin();
  if (!origin) return new Response(null, { status: 404 });
  const entries = await fetchPublicForSsr('/v1/sitemap', SitemapEntries);
  if (entries.status !== 'found') {
    return new Response(null, {
      status: 503,
      headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(sitemapXml(origin, entries.data.items), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
