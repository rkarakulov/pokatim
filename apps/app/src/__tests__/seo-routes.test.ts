/// <reference types="jest" />
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { GET as robotsGet } from '../app/robots.txt+api';
import { GET as sitemapRoute } from '../app/sitemap.xml+api';
import { parseSitemapQuery, robotsTxt, SEO_DISALLOW, sitemapPageXml } from '../lib/seo';
import { resetPublicSsrCache } from '../lib/public-ssr';

/**
 * robots.txt и sitemap.xml (landing-seo, AC1, AC2, AC5): API-маршруты web-сервера и сторож классификации маршрутов —
 * каждый экран `src/app` либо публичный, либо закрыт `Disallow`.
 */
const ORIGIN = 'https://pokatim.by';
const API = 'http://api.internal:3000';
const RACE = '0190a6f4-0000-7000-8000-000000000001';
const SEASON = '0190a6f4-0000-7000-8000-000000000002';
const ROUTE = '0190a6f4-0000-7000-8000-000000000003';
const START = '0190a6f4-0000-7000-8000-000000000004';
const AT = '2026-10-29T10:00:00.000Z';

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  resetPublicSsrCache();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.API_INTERNAL_URL = API;
  process.env.WEB_ORIGIN = `${ORIGIN}/`;
});
afterEach(() => {
  fetchMock.mockReset();
  delete process.env.API_INTERNAL_URL;
  delete process.env.WEB_ORIGIN;
});

/** Разрешён ли путь правилами robots.txt: `Allow: /` и префиксы `Disallow` (длиннее `/` — побеждают). */
const allowed = (path: string) => !SEO_DISALLOW.some((rule) => path.startsWith(rule));

/** URL экрана по файлу `src/app`: группы `(x)` и `index` убраны, `[param]` → образец. */
function screenPaths(): string[] {
  const root = join(__dirname, '..', 'app');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name) && !/^(_layout|\+html|\+not-found)\.tsx$/.test(entry.name))
        files.push(full);
    }
  };
  walk(root);
  return files.map((file) => {
    const segments = relative(root, file)
      .replace(/\.tsx$/, '')
      .split(sep)
      .filter((segment) => !/^\(.+\)$/.test(segment) && segment !== 'index')
      .map((segment) => segment.replace(/^\[(.+)\]$/, 'sample-$1'));
    return `/${segments.join('/')}`;
  });
}

/** Публичные (индексируемые или с `noindex` в мета — краулер должен её увидеть) экраны. */
const PUBLIC = [
  '/',
  '/calendar',
  '/races',
  '/rides',
  '/routes',
  '/welcome',
  '/sign-in',
  '/register',
  '/status',
  '/races/sample-id',
  '/seasons/sample-id',
  '/calendar/sample-id',
  '/routes/sample-id',
  '/riders/sample-id',
  '/rides/sample-id',
];

describe('robots.txt (AC1, AC2)', () => {
  it('text/plain: Allow /, закрытые префиксы, API открыт, Sitemap от WEB_ORIGIN', async () => {
    const res = robotsGet();
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body.startsWith('User-agent: *\nAllow: /\n')).toBe(true);
    for (const rule of ['/settings', '/tickets/', '/auth/', '/admin/'])
      expect(body).toContain(`\nDisallow: ${rule}\n`);
    expect(body).not.toContain('/v1');
    expect(body.endsWith(`\nSitemap: ${ORIGIN}/sitemap.xml\n`)).toBe(true);
  });

  it('без WEB_ORIGIN — без строки Sitemap', () => {
    expect(robotsTxt(null)).not.toContain('Sitemap');
  });

  it('сторож: каждый экран src/app — публичный или закрыт Disallow', () => {
    const unclassified = screenPaths().filter((path) => allowed(path) && !PUBLIC.includes(path));
    expect(unclassified).toEqual([]);
  });

  it('публичные экраны, их данные из API и картинки превью не закрыты; служебное — закрыто', () => {
    for (const path of PUBLIC) expect([path, allowed(path)]).toEqual([path, true]);
    for (const path of ['/v1/og/images/race/x/0123456789abcdef.png', '/v1/seasons/x/standings'])
      expect([path, allowed(path)]).toEqual([path, true]);
    for (const path of ['/admin/', '/tickets/abc', '/auth/verify/t', '/devices/return'])
      expect([path, allowed(path)]).toEqual([path, false]);
  });
});

const XML_HEAD = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];
const URLSET_HEAD = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

async function expectXml(res: Response, lines: string[]) {
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
  expect(await res.text()).toBe([...lines, ''].join('\n'));
}

function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('300');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
}

/** `GET /sitemap.xml<query>`. */
const sitemap = (query = '') => sitemapRoute(new Request(`${ORIGIN}/sitemap.xml${query}`));

describe('sitemap.xml — индекс (sitemap-index, AC1)', () => {
  it('static и страницы API — абсолютные loc в корне сайта, & экранирован, lastmod (кроме сезона)', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        pages: [
          { kind: 'race', page: 1, updatedAt: AT },
          { kind: 'race', page: 2, updatedAt: '2026-10-30T23:59:00.000Z' },
          { kind: 'season', page: 1, updatedAt: AT },
          { kind: 'calendar', page: 1, updatedAt: AT },
        ],
      }),
    );
    const res = await sitemap();
    expect(fetchMock).toHaveBeenCalledWith(`${API}/v1/sitemap`, expect.anything());
    await expectXml(res, [
      ...XML_HEAD,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=static</loc></sitemap>`,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=race&amp;page=1</loc><lastmod>2026-10-29</lastmod></sitemap>`,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=race&amp;page=2</loc><lastmod>2026-10-30</lastmod></sitemap>`,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=season&amp;page=1</loc></sitemap>`,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=calendar&amp;page=1</loc><lastmod>2026-10-29</lastmod></sitemap>`,
      '</sitemapindex>',
    ]);
  });

  it('объектов нет — индекс с одной картой static', async () => {
    fetchMock.mockImplementation(() => json(200, { pages: [] }));
    await expectXml(await sitemap(), [
      ...XML_HEAD,
      `<sitemap><loc>${ORIGIN}/sitemap.xml?kind=static</loc></sitemap>`,
      '</sitemapindex>',
    ]);
  });

  it('API недоступен или ответ не по контракту — 503 + Retry-After, no-store', async () => {
    for (const reply of [
      () => json(500, {}),
      () => json(200, { pages: [{ kind: 'ride', page: 1, updatedAt: AT }] }),
    ]) {
      resetPublicSsrCache();
      fetchMock.mockImplementation(reply);
      expectUnavailable(await sitemap());
    }
  });

  it('без WEB_ORIGIN — 404 без запроса к API', async () => {
    delete process.env.WEB_ORIGIN;
    for (const query of ['', '?kind=static', '?kind=race&page=1'])
      expect([query, (await sitemap(query)).status]).toEqual([query, 404]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sitemap.xml?kind=static (sitemap-index)', () => {
  it('лендинг /welcome без API', async () => {
    await expectXml(await sitemap('?kind=static'), [
      ...URLSET_HEAD,
      `<url><loc>${ORIGIN}/welcome</loc></url>`,
      '</urlset>',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sitemap.xml?kind=<вид>&page=<n> (sitemap-index, AC2)', () => {
  it('объекты страницы API — URL страниц вида, lastmod (кроме сезона)', async () => {
    fetchMock.mockImplementation(() => json(200, { items: [{ id: RACE, updatedAt: AT }] }));
    const res = await sitemap('?kind=race&page=2');
    expect(fetchMock).toHaveBeenCalledWith(`${API}/v1/sitemap/race/2`, expect.anything());
    await expectXml(res, [
      ...URLSET_HEAD,
      `<url><loc>${ORIGIN}/races/${RACE}</loc><lastmod>2026-10-29</lastmod></url>`,
      '</urlset>',
    ]);
  });

  it('пути видов: сезон без lastmod, маршрут, старт календаря', async () => {
    for (const [kind, id, loc, lastmod] of [
      ['season', SEASON, `/seasons/${SEASON}`, false],
      ['route', ROUTE, `/routes/${ROUTE}`, true],
      ['calendar', START, `/calendar/${START}`, true],
    ] as const) {
      resetPublicSsrCache();
      fetchMock.mockImplementation(() => json(200, { items: [{ id, updatedAt: AT }] }));
      expect(await (await sitemap(`?kind=${kind}&page=1`)).text()).toContain(
        `<url><loc>${ORIGIN}${loc}</loc>${lastmod ? '<lastmod>2026-10-29</lastmod>' : ''}</url>`,
      );
    }
  });

  it('чужой вид, номер 0, ведущий ноль, без номера, лишний или повторный параметр — 404 без запроса', async () => {
    for (const query of [
      '?kind=ride&page=1',
      '?kind=rider&page=1',
      '?kind=race&page=0',
      '?kind=race&page=01',
      '?kind=race&page=1.xml',
      '?kind=race',
      '?page=1',
      '?kind=static&page=1',
      '?kind=race&page=1&x=1',
      '?kind=race&page=1&page=2',
      '?kind=..%2Frace&page=1',
    ]) {
      expect([query, (await sitemap(query)).status]).toEqual([query, 404]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('страницы нет в индексе API — 404; API недоступен или не по контракту — 503', async () => {
    fetchMock.mockImplementation(() => json(404, { code: 'NOT_FOUND' }));
    expect((await sitemap('?kind=race&page=9')).status).toBe(404);
    for (const reply of [() => json(500, {}), () => json(200, { items: [{ id: 'x' }] })]) {
      resetPublicSsrCache();
      fetchMock.mockImplementation(reply);
      expectUnavailable(await sitemap('?kind=race&page=1'));
    }
  });
});

describe('seo: дочерние карты', () => {
  it('экранирует XML в адресе', () => {
    expect(
      sitemapPageXml('https://x.by/?a=1&b=<2>', 'race', [{ id: RACE, updatedAt: AT }]),
    ).toContain(`<loc>https://x.by/?a=1&amp;b=&lt;2&gt;/races/${RACE}</loc>`);
  });

  it('разбор query: индекс, static, страница; иное — null', () => {
    const q = (query: string) => parseSitemapQuery(new URLSearchParams(query));
    expect(q('')).toEqual({ type: 'index' });
    expect(q('kind=static')).toEqual({ type: 'static' });
    expect(q('kind=route&page=12')).toEqual({ type: 'page', kind: 'route', page: 12 });
    expect(q('kind=route&page=1234567')).toBeNull();
    expect(q('kind=static&kind=static')).toBeNull();
  });
});
