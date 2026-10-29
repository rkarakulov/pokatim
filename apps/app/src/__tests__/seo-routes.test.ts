/// <reference types="jest" />
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { GET as robotsGet } from '../app/robots.txt+api';
import { GET as sitemapGet } from '../app/sitemap.xml+api';
import { robotsTxt, SEO_ALLOW, SEO_DISALLOW, sitemapXml } from '../lib/seo';
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

/** Разрешён ли путь правилами robots.txt (самое длинное совпадение; при равенстве — Allow), как у Google. */
function allowed(path: string): boolean {
  const match = (rules: readonly string[]) =>
    Math.max(-1, ...rules.filter((rule) => path.startsWith(rule)).map((rule) => rule.length));
  return match(SEO_ALLOW) >= match(SEO_DISALLOW);
}

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
  it('text/plain: Allow /, закрытые префиксы, картинки превью открыты, Sitemap от WEB_ORIGIN', async () => {
    const res = robotsGet();
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body.startsWith('User-agent: *\nAllow: /\n')).toBe(true);
    for (const rule of ['/settings', '/tickets/', '/auth/', '/admin/', '/v1/'])
      expect(body).toContain(`\nDisallow: ${rule}\n`);
    expect(body).toContain('\nAllow: /v1/og/images/\n');
    expect(body.endsWith(`\nSitemap: ${ORIGIN}/sitemap.xml\n`)).toBe(true);
  });

  it('без WEB_ORIGIN — без строки Sitemap', () => {
    expect(robotsTxt(null)).not.toContain('Sitemap');
  });

  it('сторож: каждый экран src/app — публичный или закрыт Disallow', () => {
    const unclassified = screenPaths().filter((path) => allowed(path) && !PUBLIC.includes(path));
    expect(unclassified).toEqual([]);
  });

  it('публичные экраны и картинки превью не закрыты; служебное — закрыто', () => {
    for (const path of PUBLIC) expect([path, allowed(path)]).toEqual([path, true]);
    expect(allowed('/v1/og/images/race/x/0123456789abcdef.png')).toBe(true);
    for (const path of [
      '/v1/races',
      '/admin/',
      '/tickets/abc',
      '/auth/verify/t',
      '/devices/return',
    ])
      expect([path, allowed(path)]).toEqual([path, false]);
  });
});

describe('sitemap.xml (AC5)', () => {
  const entries = {
    items: [
      { kind: 'race', id: RACE, updatedAt: AT },
      { kind: 'season', id: SEASON, updatedAt: AT },
      { kind: 'route', id: ROUTE, updatedAt: AT },
      { kind: 'calendar', id: START, updatedAt: AT },
    ],
  };

  it('/welcome и все записи API — абсолютные URL от WEB_ORIGIN, lastmod (кроме сезона)', async () => {
    fetchMock.mockImplementation(() => json(200, entries));
    const res = await sitemapGet();
    expect(fetchMock).toHaveBeenCalledWith(`${API}/v1/sitemap`, expect.anything());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(await res.text()).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `<url><loc>${ORIGIN}/welcome</loc></url>`,
        `<url><loc>${ORIGIN}/races/${RACE}</loc><lastmod>2026-10-29</lastmod></url>`,
        `<url><loc>${ORIGIN}/seasons/${SEASON}</loc></url>`,
        `<url><loc>${ORIGIN}/routes/${ROUTE}</loc><lastmod>2026-10-29</lastmod></url>`,
        `<url><loc>${ORIGIN}/calendar/${START}</loc><lastmod>2026-10-29</lastmod></url>`,
        '</urlset>',
        '',
      ].join('\n'),
    );
  });

  it('API недоступен или ответ не по контракту — 503 + Retry-After, no-store', async () => {
    for (const reply of [() => json(500, {}), () => json(200, { items: [{ kind: 'ride' }] })]) {
      resetPublicSsrCache();
      fetchMock.mockImplementation(reply);
      const res = await sitemapGet();
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('300');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('без WEB_ORIGIN — 404 без запроса к API', async () => {
    delete process.env.WEB_ORIGIN;
    const res = await sitemapGet();
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sitemapXml', () => {
  it('экранирует XML в адресе', () => {
    expect(sitemapXml('https://x.by/?a=1&b=<2>', [])).toContain(
      '<loc>https://x.by/?a=1&amp;b=&lt;2&gt;/welcome</loc>',
    );
  });
});
