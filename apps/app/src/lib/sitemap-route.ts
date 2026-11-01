/*
 * Ответы API-маршрута карты сайта `sitemap.xml+api.ts` (landing-seo, sitemap-index): индекс и дочерние карты по query —
 * только web-сервер.
 */

/** XML карты: кэш 10 мин (у API — мемо 10 мин, у SSR-чтения — кэш процесса 60 с). */
export const sitemapResponse = (body: string): Response =>
  new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });

/** API недоступен — `503` + `Retry-After`: краулер повторит и не выкинет URL из индекса. */
export const sitemapUnavailable = (): Response =>
  new Response(null, {
    status: 503,
    headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
  });

/** Нет `WEB_ORIGIN` (адреса карты только абсолютные) или неизвестная карта. */
export const sitemapNotFound = (): Response => new Response(null, { status: 404 });
