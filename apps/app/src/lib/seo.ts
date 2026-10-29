import type { SitemapEntry, SitemapKind } from '@pokatim/contracts';

/*
 * robots.txt и sitemap.xml гостевого веба (landing-seo) — только web-сервер (API-маршруты `src/app/*+api.ts`).
 * Публичные страницы открыты; закрыты экраны только для вошедших, онбординг, ссылки с токеном, билеты, панель и API.
 * Карточки с `noindex` в мета (профиль райдера, кофе-райд) не закрываются: краулер должен увидеть `noindex`.
 * Новый экран в `src/app` — классифицируй здесь (сторож — `__tests__/seo-routes.test.ts`).
 */

/** Префиксы `Disallow` (правило robots — префикс пути). */
export const SEO_DISALLOW = [
  // ссылки из писем и возврат авторизации устройства — токен в URL; онбординг и настройка аккаунта
  '/auth/',
  '/check-email',
  '/forgot-password',
  '/devices',
  '/location',
  '/survey',
  // только вошедшим
  '/settings',
  '/profile',
  '/notifications',
  '/achievements/',
  '/rides/new',
  '/rides/edit/',
  '/rides/cancel/',
  '/rides/invite/',
  '/rides/report/',
  '/rides/route-pick',
  '/riders/report/',
  '/routes/mine/',
  '/routes/report/',
  '/routes/pick/',
  '/routes/rides/',
  '/races/pick/',
  '/races/result/',
  '/races/story/',
  // и `/races/dispute-response/`
  '/races/dispute',
  // билет — код входа на мероприятие (event-tickets)
  '/tickets/',
  '/ui-kit',
  '/admin/',
  '/v1/',
] as const;

/** Исключения из `Disallow`: картинки превью — краулерам соцсетей (Twitterbot соблюдает robots.txt). */
export const SEO_ALLOW = ['/', '/v1/og/images/'] as const;

/** `robots.txt`; `origin` (`WEB_ORIGIN`) нет — без строки `Sitemap` (нужен абсолютный адрес). */
export function robotsTxt(origin: string | null): string {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...SEO_DISALLOW.map((path) => `Disallow: ${path}`),
    ...SEO_ALLOW.filter((path) => path !== '/').map((path) => `Allow: ${path}`),
    ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : []),
  ];
  return `${lines.join('\n')}\n`;
}

/** Путь страницы объекта карты сайта. */
const PAGE_PREFIX: Record<SitemapKind, string> = {
  race: '/races',
  season: '/seasons',
  route: '/routes',
  calendar: '/calendar',
};

/** Статические публичные страницы: лендинг (корень `/` — та же мета, `og:url` `/welcome`; вкладки гостю — лендинг). */
const STATIC_PATHS = ['/welcome'] as const;

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const xml = (value: string) => value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]!);

const url = (loc: string, lastmod?: string) =>
  `<url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;

/**
 * `sitemap.xml`: статические страницы и объекты API. `lastmod` — дата изменения (UTC); у сезона нет — таблица сезона
 * меняется с результатами, дата сезона её не отражает.
 */
export function sitemapXml(origin: string, items: readonly SitemapEntry[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_PATHS.map((path) => url(`${origin}${path}`)),
    ...items.map((item) =>
      url(
        `${origin}${PAGE_PREFIX[item.kind]}/${encodeURIComponent(item.id)}`,
        item.kind === 'season' ? undefined : item.updatedAt.slice(0, 10),
      ),
    ),
    '</urlset>',
  ];
  return `${lines.join('\n')}\n`;
}
