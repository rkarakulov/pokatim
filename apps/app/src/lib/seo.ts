import {
  SITEMAP_KINDS,
  type SitemapIndexPage,
  type SitemapKind,
  type SitemapPageEntry,
} from '@pokatim/contracts';

/*
 * robots.txt и sitemap.xml гостевого веба (landing-seo; индекс и дочерние карты — sitemap-index) — только web-сервер (API-маршруты `src/app/*+api.ts`).
 * Публичные страницы открыты; закрыты экраны только для вошедших, онбординг, ссылки с токеном, билеты и панель.
 * Карточки с `noindex` в мета (профиль райдера, кофе-райд) не закрываются: краулер должен увидеть `noindex`; кроме
 * ссылок с токеном (`/auth/`, `/tickets/`) — по капабилити-URL краулер не ходит, и экранов только для вошедших
 * (карточки для сторис, приглашение райда): закрыты здесь, нейтральная мета с `noindex` — защита в глубину для HTML,
 * попавшего к краулеру в обход robots. `/v1/` открыт: JSON API не
 * индексируется, а Googlebot при рендере соблюдает robots и для fetch — публичные экраны догружают данные из API
 * (таблица сезона), картинки превью — тоже `/v1/og/images/`.
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
  '/social',
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
  '/routes/story/',
  '/routes/pick/',
  '/routes/others/',
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
  // короткая ссылка приглашения (P6): код райдера в URL, сама страница — переход на главную
  '/i/',
] as const;

/** `robots.txt`; `origin` (`WEB_ORIGIN`) нет — без строки `Sitemap` (нужен абсолютный адрес). */
export function robotsTxt(origin: string | null): string {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...SEO_DISALLOW.map((path) => `Disallow: ${path}`),
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

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

const xmlDocument = (root: 'urlset' | 'sitemapindex', entries: readonly string[]) =>
  `${[XML_HEADER, `<${root} xmlns="${SITEMAP_NS}">`, ...entries, `</${root}>`].join('\n')}\n`;

/*
 * Дочерние карты — в корне сайта, тот же маршрут `sitemap.xml` с query (протокол sitemaps.org: карта перечисляет только
 * URL ниже своего каталога, а `/sitemap/…` перечисляла бы `/races/…`): без параметров — индекс, `?kind=static` —
 * статические страницы, `?kind=<вид>&page=<n>` — страница вида.
 */
export type SitemapTarget =
  { type: 'index' } | { type: 'static' } | { type: 'page'; kind: SitemapKind; page: number };

const SITEMAP_PATH = '/sitemap.xml';
const PAGE_IN_QUERY = /^[1-9]\d{0,5}$/;

/** Адрес дочерней карты (без экранирования XML). */
export const sitemapHref = (target: Exclude<SitemapTarget, { type: 'index' }>): string =>
  target.type === 'static'
    ? `${SITEMAP_PATH}?kind=static`
    : `${SITEMAP_PATH}?kind=${target.kind}&page=${target.page}`;

/**
 * Query `sitemap.xml` → карта; лишний, повторный или неверный параметр (вид, номер с 1 без ведущих нулей) — `null`
 * (без запроса к API).
 */
export function parseSitemapQuery(query: URLSearchParams): SitemapTarget | null {
  const keys = [...query.keys()];
  if (keys.length === 0) return { type: 'index' };
  const kind = query.get('kind');
  if (kind === 'static') return keys.length === 1 ? { type: 'static' } : null;
  const page = query.get('page');
  if (keys.length !== 2 || kind === null || page === null) return null;
  if (!(SITEMAP_KINDS as readonly string[]).includes(kind) || !PAGE_IN_QUERY.test(page))
    return null;
  return { type: 'page', kind: kind as SitemapKind, page: Number(page) };
}

/** `lastmod` вида (дата UTC); у сезона нет — таблица сезона меняется с результатами, дата сезона её не отражает. */
const lastmodOf = (kind: SitemapKind, updatedAt: string) =>
  kind === 'season' ? undefined : updatedAt.slice(0, 10);

/**
 * `sitemap.xml` — индекс (протокол sitemaps.org): статические страницы и страницы видов API, `lastmod` страницы —
 * из индекса API (кроме сезонов). `&` адреса экранируется (`&amp;`).
 */
export function sitemapIndexXml(origin: string, pages: readonly SitemapIndexPage[]): string {
  const sitemap = (loc: string, lastmod?: string) =>
    `<sitemap><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`;
  return xmlDocument('sitemapindex', [
    sitemap(`${origin}${sitemapHref({ type: 'static' })}`),
    ...pages.map((page) =>
      sitemap(
        `${origin}${sitemapHref({ type: 'page', kind: page.kind, page: page.page })}`,
        lastmodOf(page.kind, page.updatedAt),
      ),
    ),
  ]);
}

/** Дочерняя карта статических страниц. */
export const staticSitemapXml = (origin: string): string =>
  xmlDocument(
    'urlset',
    STATIC_PATHS.map((path) => url(`${origin}${path}`)),
  );

/** Дочерняя карта страницы вида: URL объектов, `lastmod` — дата изменения (кроме сезона). */
export function sitemapPageXml(
  origin: string,
  kind: SitemapKind,
  items: readonly SitemapPageEntry[],
): string {
  return xmlDocument(
    'urlset',
    items.map((item) =>
      url(
        `${origin}${PAGE_PREFIX[kind]}/${encodeURIComponent(item.id)}`,
        lastmodOf(kind, item.updatedAt),
      ),
    ),
  );
}
