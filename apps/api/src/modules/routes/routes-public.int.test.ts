import {
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  type CityCode,
  RouteMapGeometry,
  type Surface,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import { ROUTES, routesDb } from '../../../test/routes';
import type { RouteDoc } from './routes.collection';

/**
 * Публичный каталог маршрутов (routes-01, AC2, AC3): только опубликованные, порядок и курсор, фильтры, кэш, состав
 * ответа, видимость карточки и карты, `explain` списка. Маршруты — напрямую в БД (подготовка).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

let ipCounter = 0;
/** Публичный GET с отдельного IP (лимит не делится между проверками). */
const get = (url: string) =>
  call(h, 'GET', url, undefined, { 'x-forwarded-for': `203.0.113.${(ipCounter++ % 200) + 1}` });

const LINE: [number, number][] = [
  [27.55, 53.9],
  [27.56, 53.91],
  [27.57, 53.905],
];

interface Seed {
  distanceM?: number;
  city?: CityCode;
  surfaces?: Surface[];
  publishedAt?: Date | null;
  status?: RouteDoc['status'];
  title?: string;
  id?: string;
}

/** Готовый маршрут (по умолчанию опубликован «сейчас») с линией показа. */
async function seedRoute(seed: Seed = {}): Promise<string> {
  const id = seed.id ?? uuidv7();
  const now = h.clock.now();
  const status = seed.status ?? 'ready';
  const publishedAt = seed.publishedAt === undefined ? now : seed.publishedAt;
  await routesDb(h).routes.insertOne({
    _id: id,
    origin: 'platform',
    ownerUserId: uuidv7(),
    title: seed.title ?? `Маршрут ${id.slice(-4)}`,
    status,
    failure: null,
    attempts: 1,
    sha256: id,
    sizeBytes: 1000,
    distanceM: seed.distanceM ?? 42_000,
    elevationGainM: 310,
    isLoop: false,
    start: { type: 'Point', coordinates: LINE[0]! },
    finish: { type: 'Point', coordinates: LINE.at(-1)! },
    catalog: publishedAt
      ? {
          city: seed.city ?? 'minsk',
          surfaces: seed.surfaces ?? ['asphalt'],
          publishedAt,
        }
      : null,
    createdAt: now,
    updatedAt: now,
  });
  if (status === 'ready') {
    await routesDb(h).geometries.insertOne({
      _id: id,
      line: { type: 'LineString', coordinates: LINE },
      matchLine: LINE,
      sourcePointCount: LINE.length,
    });
  }
  return id;
}

const page = async (query = '') => {
  const res = await get(`/v1/routes${query}`);
  expect(res.status, `${query}: ${JSON.stringify(res.body)}`).toBe(200);
  return CatalogRoutePage.parse(res.body);
};
const ids = async (query = '') => (await page(query)).items.map((item) => item.id);

const CARD_KEYS = [
  'city',
  'distanceM',
  'elevationGainM',
  'id',
  'isLoop',
  'publishedAt',
  'surfaces',
  'title',
];
const HIDDEN =
  /ownerUserId|sha256|"status"|failure|attempts|matchLine|sizeBytes|createdAt|updatedAt/;

describe('GET /v1/routes (AC2)', () => {
  it('только опубликованные готовые, новые публикации сверху; ключи — ровно контрактные; кэш public 60', async () => {
    const t = h.clock.now().getTime();
    const older = await seedRoute({ publishedAt: new Date(t - 2 * MINUTE) });
    const newer = await seedRoute({ publishedAt: new Date(t - MINUTE) });
    await seedRoute({ publishedAt: null });
    await seedRoute({ status: 'processing', publishedAt: null });

    const res = await get('/v1/routes');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = CatalogRoutePage.parse(res.body);
    expect(body.items.map((item) => item.id)).toEqual([newer, older]);
    expect(body.nextCursor).toBeNull();
    const raw = res.body as { items: Record<string, unknown>[] };
    for (const item of raw.items) expect(Object.keys(item).sort()).toEqual(CARD_KEYS);
    expect(JSON.stringify(res.body)).not.toMatch(HIDDEN);
    expect(raw.items[0]).toEqual({
      id: newer,
      title: expect.any(String),
      distanceM: 42_000,
      elevationGainM: 310,
      isLoop: false,
      city: 'minsk',
      surfaces: ['asphalt'],
      publishedAt: new Date(t - MINUTE).toISOString(),
    });
  });

  it('курсор по 2 на 5 маршрутах — без дублей и пропусков, одинаковый publishedAt — тай-брейк по _id', async () => {
    const t = h.clock.now().getTime();
    const same = new Date(t - 3 * MINUTE);
    const seeded = [
      await seedRoute({ publishedAt: new Date(t - 5 * MINUTE) }),
      await seedRoute({ publishedAt: same }),
      await seedRoute({ publishedAt: same }),
      await seedRoute({ publishedAt: same }),
      await seedRoute({ publishedAt: new Date(t - MINUTE) }),
    ];
    const expected = [seeded[4], seeded[3], seeded[2], seeded[1], seeded[0]];

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const next: CatalogRoutePage = await page(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
  });

  it('фильтры: город, два города, корзины с границами, две корзины, покрытие (хотя бы одно), комбинации', async () => {
    const t = h.clock.now().getTime();
    let n = 0;
    const at = () => new Date(t - ++n * MINUTE);
    const r49 = await seedRoute({
      distanceM: 49_999,
      city: 'minsk',
      surfaces: ['asphalt'],
      publishedAt: at(),
    });
    const r50 = await seedRoute({
      distanceM: 50_000,
      city: 'brest',
      surfaces: ['gravel'],
      publishedAt: at(),
    });
    const r100 = await seedRoute({
      distanceM: 100_000,
      city: 'minsk',
      surfaces: ['asphalt', 'gravel'],
      publishedAt: at(),
    });
    const r101 = await seedRoute({
      distanceM: 100_001,
      city: 'grodno',
      surfaces: ['asphalt'],
      publishedAt: at(),
    });

    expect(await ids('?city=minsk')).toEqual([r49, r100]);
    expect(await ids('?city=minsk&city=brest')).toEqual([r49, r50, r100]);
    expect(await ids('?distance=lt50')).toEqual([r49]);
    expect(await ids('?distance=50to100')).toEqual([r50, r100]);
    expect(await ids('?distance=gt100')).toEqual([r101]);
    expect(await ids('?distance=lt50&distance=gt100')).toEqual([r49, r101]);
    expect(await ids('?surface=gravel')).toEqual([r50, r100]);
    expect(await ids('?surface=asphalt&surface=gravel')).toEqual([r49, r50, r100, r101]);
    expect(await ids('?city=minsk&surface=gravel')).toEqual([r100]);
    expect(await ids('?city=minsk&city=grodno&distance=gt100&surface=asphalt')).toEqual([r101]);
    expect(await ids('?city=vitebsk')).toEqual([]);
  });

  it('мусорный курсор, неизвестные город/корзина/покрытие, лишний ключ, limit 51 — 400', async () => {
    await seedRoute();
    const garbage = Buffer.from(JSON.stringify({ k: { $gt: '' }, id: uuidv7() })).toString(
      'base64url',
    );
    for (const query of [
      'cursor=abc',
      `cursor=${garbage}`,
      'distance=lt10',
      'city=moscow',
      'surface=cobbles',
      'status=processing',
      'limit=51',
      'limit=0',
    ]) {
      const res = await get(`/v1/routes?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('список — IXSCAN routes_catalog_idx без SORT', async () => {
    const t = h.clock.now().getTime();
    for (let i = 1; i <= 5; i += 1) {
      await seedRoute({ publishedAt: new Date(t - i * MINUTE), city: i % 2 ? 'minsk' : 'brest' });
    }
    await h.db.command({ profile: 2 });
    try {
      const first = await page('?limit=2&city=minsk&distance=lt50&surface=asphalt');
      await page(`?limit=2&city=minsk&distance=lt50&surface=asphalt&cursor=${first.nextCursor}`);
    } finally {
      await h.db.command({ profile: 0 });
    }
    const entries = await h.db
      .collection<{ planSummary?: string; hasSortStage?: boolean }>('system.profile')
      .find({ ns: `${h.db.databaseName}.routes`, op: 'query', 'command.sort': { $exists: true } })
      .toArray();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.planSummary).toContain('IXSCAN { catalog.publishedAt: -1, _id: -1 }');
      expect(entry.hasSortStage ?? false).toBe(false);
    }
  });
});

describe('GET /v1/routes/cities', () => {
  it('статический путь — 200 (не 400 pipe Uuid); только города опубликованных; кэш', async () => {
    await seedRoute({ city: 'minsk' });
    await seedRoute({ city: 'brest' });
    await seedRoute({ city: 'minsk' });
    await seedRoute({ city: 'grodno', publishedAt: null });

    const res = await get('/v1/routes/cities');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(CatalogRouteCities.parse(res.body).cities.sort()).toEqual(['brest', 'minsk']);
  });
});

describe('GET /v1/routes/:id и /map (AC3)', () => {
  it('опубликованный — 200: карточка с контрактными ключами, карта — ровно bounds, finish, line, start', async () => {
    const id = await seedRoute({ city: 'brest', surfaces: ['gravel'] });

    const detail = await get(`/v1/routes/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.headers['cache-control']).toBe('public, max-age=60');
    expect(Object.keys(detail.body as object).sort()).toEqual(CARD_KEYS);
    expect(CatalogRouteDetail.parse(detail.body)).toMatchObject({
      id,
      city: 'brest',
      surfaces: ['gravel'],
    });
    expect(JSON.stringify(detail.body)).not.toMatch(HIDDEN);

    const map = await get(`/v1/routes/${id}/map`);
    expect(map.status).toBe(200);
    expect(map.headers['cache-control']).toBe('public, max-age=60');
    expect(Object.keys(map.body as object).sort()).toEqual(['bounds', 'finish', 'line', 'start']);
    const geometry = RouteMapGeometry.parse(map.body);
    const stored = await routesDb(h).geometries.findOne({ _id: id });
    expect(geometry.line).toEqual(stored!.line.coordinates);
    expect(geometry.start).toEqual(LINE[0]);
    expect(geometry.finish).toEqual(LINE.at(-1));
    expect(geometry.bounds).toEqual([27.55, 53.9, 27.57, 53.91]);
  });

  it('не опубликованный, processing, неизвестный — 404 NOT_FOUND; not-a-uuid — 400', async () => {
    const hidden = await seedRoute({ publishedAt: null });
    const processing = await seedRoute({ status: 'processing', publishedAt: null });
    for (const id of [hidden, processing, uuidv7()]) {
      for (const suffix of ['', '/map']) {
        const res = await get(`/v1/routes/${id}${suffix}`);
        expect(res.status, `${id}${suffix}`).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
    expect((await get('/v1/routes/not-a-uuid')).status).toBe(400);
    expect((await get('/v1/routes/not-a-uuid/map')).status).toBe(400);
  });

  it('снятый в панели — сразу 404 в карточке, карте, списке и городах', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await seedRoute({ city: 'gomel' });
    expect((await get(`/v1/routes/${id}`)).status).toBe(200);
    expect((await get(`/v1/routes/${id}/map`)).status).toBe(200);

    expect((await panelCall(h, org.token, 'POST', `${ROUTES}/${id}/unpublish`, {})).status).toBe(
      200,
    );
    expect((await get(`/v1/routes/${id}`)).status).toBe(404);
    expect((await get(`/v1/routes/${id}/map`)).status).toBe(404);
    expect(await ids()).toEqual([]);
    expect(CatalogRouteCities.parse((await get('/v1/routes/cities')).body).cities).toEqual([]);

    expect(
      (
        await panelCall(h, org.token, 'POST', `${ROUTES}/${id}/publish`, {
          city: 'gomel',
          surfaces: ['asphalt'],
        })
      ).status,
    ).toBe(200);
    expect(CatalogRouteCard.parse((await get(`/v1/routes/${id}`)).body).city).toBe('gomel');
  });
});
