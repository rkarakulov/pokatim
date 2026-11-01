import { SitemapIndex, SitemapPage } from '@pokatim/contracts';
import type { FindCursor } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { seedRace, seedStart, startsDb } from '../../../test/og';
import { racesDb } from '../../../test/races';
import { routesDb, seedRiderRoute } from '../../../test/routes';
import { createRide, rider, seedTeamRoute } from '../../../test/rides';
import { seedSeason } from '../../../test/standings';
import { SITEMAP_INDEXES } from '../../db/migrations/0051_sitemap_indexes';
import { SITEMAP_POLICY } from './sharing.policy';
import { SitemapService } from './sitemap.service';

/**
 * Карта сайта (landing-seo, sitemap-index): `GET /v1/sitemap` — индекс страниц видов, `GET /v1/sitemap/:kind/:page` —
 * объекты страницы по `_id` ↑; только опубликованные гонки, сезоны, маршруты каталога и старты календаря; мемо
 * процесса; план keyset без `SORT`. MongoDB — настоящая.
 */
let h: Harness;
let ip = 0;
const saved = { ...SITEMAP_POLICY };
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  h.app.get(SitemapService).forget();
  ip += 1;
});
afterEach(() => {
  Object.assign(SITEMAP_POLICY, saved);
});
afterAll(async () => {
  await h.close();
});

const get = (url: string) =>
  h.app.inject({ method: 'GET', url, headers: { 'x-forwarded-for': `10.8.${ip % 250}.1` } });

async function index() {
  const res = await get('/v1/sitemap');
  expect(res.statusCode, res.body).toBe(200);
  return SitemapIndex.parse(res.json()).pages;
}

async function page(kind: string, n: number) {
  const res = await get(`/v1/sitemap/${kind}/${n}`);
  expect(res.statusCode, res.body).toBe(200);
  return SitemapPage.parse(res.json()).items.map((item) => item.id);
}

/** Все объекты по страницам индекса: `kind:id` в порядке страниц. */
async function everything() {
  const keys: string[] = [];
  for (const { kind, page: n } of await index())
    keys.push(...(await page(kind, n)).map((id) => `${kind}:${id}`));
  return keys;
}

const id = (n: number) => `01890a5d-ac96-774b-bcce-${n.toString(16).padStart(12, '0')}`;

describe('GET /v1/sitemap и /v1/sitemap/:kind/:page', () => {
  it('публичные объекты 4 видов: по странице на вид, дата изменения; кэш 60 с; без входа', async () => {
    const routeId = await seedTeamRoute(h);
    const race = await seedRace(h);
    const season = await seedSeason(h);
    const start = await seedStart(h);
    const res = await get('/v1/sitemap');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const now = h.clock.now().toISOString();
    expect(SitemapIndex.parse(res.json()).pages).toEqual([
      { kind: 'race', page: 1, updatedAt: now },
      { kind: 'season', page: 1, updatedAt: now },
      { kind: 'route', page: 1, updatedAt: now },
      { kind: 'calendar', page: 1, updatedAt: now },
    ]);
    const child = await get('/v1/sitemap/race/1');
    expect(child.headers['cache-control']).toBe('public, max-age=60');
    expect(SitemapPage.parse(child.json())).toEqual({ items: [{ id: race, updatedAt: now }] });
    expect(await everything()).toEqual([
      `race:${race}`,
      `season:${season}`,
      `route:${routeId}`,
      `calendar:${start}`,
    ]);
  });

  it('черновик и отменённая гонка, маршрут не в каталоге, неопубликованный старт, райды — не входят', async () => {
    const organizer = await rider(h, 'org@example.by');
    await seedRace(h, { status: 'draft' });
    await seedRace(h, { status: 'cancelled' });
    await seedRiderRoute(h, organizer.userId);
    await seedStart(h, { status: 'unpublished' });
    await createRide(h, organizer);
    expect(await index()).toEqual([]);
    expect((await get('/v1/sitemap/race/1')).statusCode).toBe(404);
  });

  it('больше pageSize: страницы по _id без потерь и дублей; вне индекса — 404; неверные параметры — 400', async () => {
    Object.assign(SITEMAP_POLICY, { pageSize: 2, scanPage: 3 });
    for (const n of [5, 1, 4, 2, 3]) await seedRace(h, { _id: id(n) });
    await seedRace(h, { _id: id(6), status: 'draft' });
    expect((await index()).map(({ kind, page: n }) => `${kind}/${n}`)).toEqual([
      'race/1',
      'race/2',
      'race/3',
    ]);
    expect([await page('race', 1), await page('race', 2), await page('race', 3)]).toEqual([
      [id(1), id(2)],
      [id(3), id(4)],
      [id(5)],
    ]);
    expect((await get('/v1/sitemap/race/4')).statusCode).toBe(404);
    expect((await get('/v1/sitemap/season/1')).statusCode).toBe(404);
    for (const url of ['/v1/sitemap/ride/1', '/v1/sitemap/race/0', '/v1/sitemap/race/1.xml'])
      expect([url, (await get(url)).statusCode]).toEqual([url, 400]);
  });

  it('правка старого объекта не переносит его; свежий — в карте после окна мемо (не «первые N по updatedAt»)', async () => {
    Object.assign(SITEMAP_POLICY, { pageSize: 2 });
    for (const n of [1, 2, 3]) await seedRace(h, { _id: id(n) });
    expect(await page('race', 1)).toEqual([id(1), id(2)]);
    h.clock.advance(SITEMAP_POLICY.memoMs + MINUTE);
    await racesDb(h).races.updateOne({ _id: id(1) }, { $set: { updatedAt: h.clock.now() } });
    await seedRace(h, { _id: id(9) });
    const pages = await index();
    expect(pages.map(({ page: n }) => n)).toEqual([1, 2]);
    expect(pages[0]!.updatedAt).toBe(h.clock.now().toISOString());
    expect(await page('race', 1)).toEqual([id(1), id(2)]);
    expect(await page('race', 2)).toEqual([id(3), id(9)]);
  });

  it('мемо: в окне — прежний ответ без чтения БД; после окна — новые объекты', async () => {
    const first = await seedRace(h);
    expect(await everything()).toEqual([`race:${first}`]);
    const second = await seedRace(h);
    h.clock.advance(SITEMAP_POLICY.memoMs - MINUTE);
    expect(await everything()).toEqual([`race:${first}`]);
    h.clock.advance(2 * MINUTE);
    expect((await everything()).sort()).toEqual([`race:${first}`, `race:${second}`].sort());
  });
});

describe('план keyset карты сайта (sitemap-index)', () => {
  const after = { _id: { $gt: id(0) } };
  const projection = { _id: 1, updatedAt: 1 };
  /** Победивший план `find` keyset по `_id` (как `sitemapAfter` репозиториев). */
  const winning = async (cursor: FindCursor) => {
    const explain = await cursor.sort({ _id: 1 }).limit(SITEMAP_POLICY.scanPage).explain();
    return JSON.stringify(explain.queryPlanner.winningPlan);
  };

  it('гонки и старты — IXSCAN по *_sitemap_idx без SORT и FETCH (покрывающий)', async () => {
    for (const n of [1, 2, 3]) {
      await seedRace(h, { _id: id(n) });
      await seedStart(h, { _id: id(n) });
    }
    const races = await winning(
      racesDb(h).races.find({ status: 'published', ...after }, { projection }),
    );
    const starts = await winning(
      startsDb(h).find({ status: 'published', ...after }, { projection }),
    );
    for (const [plan, name] of [
      [races, SITEMAP_INDEXES.races.options.name],
      [starts, SITEMAP_INDEXES.calendar.options.name],
    ] as const) {
      expect(plan).toContain(`"indexName":"${name}"`);
      expect(plan).not.toContain('"SORT"');
      expect(plan).not.toContain('"FETCH"');
    }
  });

  it('маршруты каталога (условие `IN_CATALOG`) — IXSCAN по routes_sitemap_idx без SORT', async () => {
    await seedTeamRoute(h);
    await seedTeamRoute(h, [27.5, 53.9], 'Второе кольцо');
    const inCatalog = {
      status: 'ready' as const,
      'catalog.publishedAt': { $type: 'date' as const },
      $or: [
        { origin: 'platform' as const },
        { origin: 'rider' as const, 'publication.status': 'approved' },
      ],
    };
    const plan = await winning(
      routesDb(h).routes.find({ $and: [inCatalog, after] }, { projection }),
    );
    expect(plan).toContain(`"indexName":"${SITEMAP_INDEXES.routes.options.name}"`);
    expect(plan).not.toContain('"SORT"');
  });
});
