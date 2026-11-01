import { ogOrigin } from '@/lib/og-image';
import { staticSitemapXml } from '@/lib/seo';
import { sitemapNotFound, sitemapResponse } from '@/lib/sitemap-route';

/** `sitemap/static.xml` (sitemap-index): статические публичные страницы (лендинг), без API. Нет `WEB_ORIGIN` — `404`. */
export function GET(): Response {
  const origin = ogOrigin();
  if (!origin) return sitemapNotFound();
  return sitemapResponse(staticSitemapXml(origin));
}
