import { gunzipSync, gzipSync } from 'node:zlib';

import {
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  type CityCode,
  RouteMapGeometry,
  type Surface,
} from '@pokatim/contracts';
import {
  parseGpx,
  parseKml,
  parseTcx,
  ROUTE_MAX_POINTS,
  routeKml,
  routeTcx,
} from '@pokatim/tracks/parse';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Binary } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  fixture,
  publicationDoc,
  ROUTES,
  readyRoute,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { ROUTE_CATALOG, type RouteCatalog } from './route-catalog.port';
import { ROUTE_GEOMETRY, type RouteGeometry } from './route-geometry.port';
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
  'author',
  'city',
  'distanceM',
  'elevationGainM',
  'id',
  'isLoop',
  'publishedAt',
  'surfaces',
  'title',
];
/** Карточка (routes-03): ключи списка + профиль высоты, признак GPX и форматы скачивания (routes-formats). */
const DETAIL_KEYS = [...CARD_KEYS, 'elevation', 'gpxAvailable', 'exportFormats'].sort();
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
      author: { kind: 'team' },
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
    expect(Object.keys(detail.body as object).sort()).toEqual(DETAIL_KEYS);
    expect(CatalogRouteDetail.parse(detail.body)).toMatchObject({
      id,
      city: 'brest',
      surfaces: ['gravel'],
      // маршрут до routes-03: производных данных нет
      elevation: null,
      gpxAvailable: false,
      exportFormats: [],
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
      for (const suffix of ['', '/map', '/gpx', '/kml', '/tcx']) {
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

/** Публичный GET файла (тело — не JSON) с адреса `ip`; `headers` — дополнительные заголовки запроса. */
const getRaw = (url: string, ip: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers: { 'x-forwarded-for': ip, ...headers } });

/**
 * Производные данные маршрута — напрямую в БД (подготовка): версия 1 (routes-03) — только GPX; с `files` — версия 2
 * (routes-formats) с KML и TCX. Без `gzip` — старый несжатый документ (без `encoding`); с `gzip` — как пишет worker
 * (route-exports-gzip).
 */
async function seedDerived(
  id: string,
  profile: [number, number][] | null,
  gpx: string,
  files?: { kml: string; tcx: string },
  { gzip = false }: { gzip?: boolean } = {},
) {
  const derivedVersion = files ? 2 : 1;
  await routesDb(h).geometries.updateOne({ _id: id }, { $set: { profile, derivedVersion } });
  const encode = (text: string) =>
    new Binary(gzip ? gzipSync(text) : new TextEncoder().encode(text));
  await routesDb(h).exports.insertOne({
    _id: id,
    gpx: encode(gpx),
    ...(files ? { kml: encode(files.kml), tcx: encode(files.tcx) } : {}),
    ...(gzip ? { encoding: 'gzip' as const } : {}),
    sizeBytes: 0,
    derivedVersion,
  });
}

const KML_TEXT = routeKml([
  { lat: 53.9, lon: 27.55, ele: 191 },
  { lat: 53.91, lon: 27.56, ele: 267 },
]);
const TCX_TEXT = routeTcx([
  { lat: 53.9, lon: 27.55, ele: 191 },
  { lat: 53.91, lon: 27.56, ele: 267 },
]);
const FILES = { kml: KML_TEXT, tcx: TCX_TEXT };

const GPX_TEXT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pokatim" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><trkseg>\n<trkpt lat="53.900000" lon="27.550000"><ele>191.0</ele></trkpt>\n<trkpt lat="53.910000" lon="27.560000"><ele>267.0</ele></trkpt>\n</trkseg></trk>\n</gpx>\n';

describe('карточка: профиль высоты и gpxAvailable (routes-03, AC2, AC3)', () => {
  it('без высот — elevation: null, gpxAvailable: true; с профилем — min/max по профилю', async () => {
    const flat = await seedRoute();
    await seedDerived(flat, null, GPX_TEXT);
    const flatDetail = await get(`/v1/routes/${flat}`);
    expect(Object.keys(flatDetail.body as object).sort()).toEqual(DETAIL_KEYS);
    // версия 1 (до routes-formats): только GPX
    expect(flatDetail.body).toMatchObject({
      elevation: null,
      gpxAvailable: true,
      exportFormats: ['gpx'],
    });

    const hilly = await seedRoute();
    const profile: [number, number][] = [
      [0, 200],
      [21_000, 191],
      [42_000, 267],
    ];
    await seedDerived(hilly, profile, GPX_TEXT);
    expect(CatalogRouteDetail.parse((await get(`/v1/routes/${hilly}`)).body)).toMatchObject({
      elevation: { minM: 191, maxM: 267, profile },
      gpxAvailable: true,
    });
  });

  it('новый маршрут после разбора worker: профиль ≤ 300 точек от 0 до distanceM, GPX доступен', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token, 'route-trk-no-time.gpx', 'Холмы');
    expect(
      (
        await panelCall(h, org.token, 'POST', `${ROUTES}/${id}/publish`, {
          city: 'minsk',
          surfaces: ['asphalt'],
        })
      ).status,
    ).toBe(200);
    const detail = CatalogRouteDetail.parse((await get(`/v1/routes/${id}`)).body);
    const elevation = detail.elevation!;
    expect(detail.gpxAvailable).toBe(true);
    expect(detail.exportFormats).toEqual(['gpx', 'kml', 'tcx']);
    expect(elevation.minM).toBeLessThanOrEqual(elevation.maxM);
    expect(elevation.profile.length).toBeLessThanOrEqual(300);
    expect(elevation.profile[0]![0]).toBe(0);
    expect(elevation.profile.at(-1)![0]).toBe(detail.distanceM);

    const res = await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.7');
    expect(res.statusCode).toBe(200);
    const gpx = res.body;
    expect(parseGpx(gpx).points.length).toBeGreaterThan(1);
    for (const hidden of ['<time', '<extensions', '<metadata', '<name', 'Холмы']) {
      expect(gpx).not.toContain(hidden);
    }
    // в исходнике есть metadata и имя трека — в очищенный файл они не попадают
    const source = fixture('route-trk-no-time.gpx').toString('utf8');
    expect(source).toContain('<metadata><name>Маршрут планировщика</name></metadata>');
    expect(gpx).not.toContain('Маршрут планировщика');

    // routes-formats: KML и TCX из тех же точек, без строк исходника и названия
    const gpxPoints = parseGpx(gpx).points.map((p) => [p.lon, p.lat]);
    const options = { maxPoints: ROUTE_MAX_POINTS };
    for (const [format, parse] of [
      ['kml', (text: string) => parseKml(text, options).points],
      ['tcx', (text: string) => parseTcx(text, options).points],
    ] as const) {
      const file = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.7');
      expect(file.statusCode, format).toBe(200);
      expect(parse(file.body).map((p) => [p.lon, p.lat])).toEqual(gpxPoints);
      for (const hidden of ['<name>Маршрут', 'Холмы', 'Маршрут планировщика', '<metadata']) {
        expect(file.body).not.toContain(hidden);
      }
    }
  });
});

describe('GET /v1/routes/:id/kml и /tcx (routes-formats, AC7)', () => {
  it.each([
    ['kml', 'application/vnd.google-earth.kml+xml; charset=utf-8', () => KML_TEXT],
    ['tcx', 'application/vnd.garmin.tcx+xml; charset=utf-8', () => TCX_TEXT],
  ] as const)(
    '%s: 200 — байты экспорта, Content-Type, имя из названия (bidi удалён), кэш, nosniff, CSP sandbox',
    async (format, contentType, body) => {
      const id = await seedRoute({ title: `Круг (Минск) \u202Eexe.${format}` });
      await seedDerived(id, null, GPX_TEXT, FILES);
      const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.21');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(body());
      expect(res.headers['content-type']).toBe(contentType);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="pokatim-route.${format}"; filename*=UTF-8''${encodeURIComponent('Круг ')}%28${encodeURIComponent('Минск')}%29%20exe.${format}.${format}`,
      );
      expect(CatalogRouteDetail.parse((await get(`/v1/routes/${id}`)).body)).toMatchObject({
        gpxAvailable: true,
        exportFormats: ['gpx', 'kml', 'tcx'],
      });
    },
  );

  it('экспорт версии 1 (без полей kml/tcx): /kml и /tcx — 404 JSON, /gpx — 200, exportFormats: [gpx]', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT);
    for (const format of ['kml', 'tcx']) {
      const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.22');
      expect(res.statusCode, format).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.headers['content-type']).toContain('application/json');
    }
    expect((await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.22')).statusCode).toBe(200);
    const detail = CatalogRouteDetail.parse((await get(`/v1/routes/${id}`)).body);
    expect(detail.exportFormats).toEqual(['gpx']);
    expect(detail.gpxAvailable).toBe(true);
  });

  it('не в каталоге, без экспорта, неизвестный — 404; не UUID — 400', async () => {
    const hidden = await seedRoute({ publishedAt: null });
    await seedDerived(hidden, null, GPX_TEXT, FILES);
    const noExport = await seedRoute();
    for (const id of [hidden, noExport, uuidv7()]) {
      for (const format of ['kml', 'tcx']) {
        const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.23');
        expect(res.statusCode, `${id}/${format}`).toBe(404);
        expect(res.headers['content-disposition']).toBeUndefined();
      }
    }
    expect((await getRaw('/v1/routes/not-a-uuid/kml', '198.51.100.23')).statusCode).toBe(400);
    expect((await getRaw('/v1/routes/not-a-uuid/tcx', '198.51.100.23')).statusCode).toBe(400);
  });

  it('IP-лимит общий с GPX: 30 скачиваний GPX+KML+TCX вместе — 31-е любого формата 429', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT, FILES);
    const formats = ['gpx', 'kml', 'tcx'] as const;
    for (let i = 0; i < 30; i += 1) {
      const res = await getRaw(`/v1/routes/${id}/${formats[i % 3]}`, '198.51.100.24');
      expect(res.statusCode, String(i)).toBe(200);
    }
    for (const format of formats) {
      const limited = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.24');
      expect(limited.statusCode, format).toBe(429);
      expect(limited.headers['content-disposition']).toBeUndefined();
    }
    expect((await getRaw(`/v1/routes/${id}/kml`, '198.51.100.25')).statusCode).toBe(200);
  });
});

describe('GET /v1/routes/:id/gpx (routes-03, AC4)', () => {
  it('200: тело — байты экспорта, заголовки файла, кэш, nosniff, CSP sandbox; имя из названия', async () => {
    const id = await seedRoute({ title: 'Круг (Минск) \u202Eexe.gpx' });
    await seedDerived(id, null, GPX_TEXT);
    const res = await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(GPX_TEXT);
    expect(res.headers['content-type']).toBe('application/gpx+xml; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="pokatim-route.gpx"; filename*=UTF-8''${encodeURIComponent('Круг ')}%28${encodeURIComponent('Минск')}%29%20exe.gpx.gpx`,
    );
  });

  it('не опубликован, снят, processing, неизвестный, без экспорта — 404 без Content-Disposition; не UUID — 400', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const hidden = await seedRoute({ publishedAt: null });
    await seedDerived(hidden, null, GPX_TEXT);
    const unpublished = await seedRoute();
    await seedDerived(unpublished, null, GPX_TEXT);
    expect(
      (await panelCall(h, org.token, 'POST', `${ROUTES}/${unpublished}/unpublish`, {})).status,
    ).toBe(200);
    const processing = await seedRoute({ status: 'processing', publishedAt: null });
    const noExport = await seedRoute();
    for (const id of [hidden, unpublished, processing, noExport, uuidv7()]) {
      const res = await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.2');
      expect(res.statusCode, id).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.headers['content-type']).toContain('application/json');
    }
    expect((await getRaw('/v1/routes/not-a-uuid/gpx', '198.51.100.2')).statusCode).toBe(400);
  });

  it('31-й запрос с адреса — 429 + Retry-After; другой адрес не задет; public-read по-прежнему 300', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT);
    for (let i = 0; i < 30; i += 1) {
      expect((await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.3')).statusCode).toBe(200);
    }
    const limited = await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.3');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['content-disposition']).toBeUndefined();
    expect((await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.4')).statusCode).toBe(200);
    // карточка с того же адреса — лимит public-read (300) не исчерпан
    expect((await getRaw(`/v1/routes/${id}`, '198.51.100.3')).statusCode).toBe(200);
  });
});

describe('route_exports gzip (route-exports-gzip)', () => {
  const TEXTS = { gpx: GPX_TEXT, kml: KML_TEXT, tcx: TCX_TEXT } as const;
  const TYPES = {
    gpx: 'application/gpx+xml; charset=utf-8',
    kml: 'application/vnd.google-earth.kml+xml; charset=utf-8',
    tcx: 'application/vnd.garmin.tcx+xml; charset=utf-8',
  } as const;

  it.each(['gpx', 'kml', 'tcx'] as const)(
    '%s: gzip в БД + Accept-Encoding: gzip → Content-Encoding: gzip, Vary, тело распаковывается в файл; прочие заголовки прежние (AC2)',
    async (format) => {
      const id = await seedRoute({ title: 'Круг' });
      await seedDerived(id, null, GPX_TEXT, FILES, { gzip: true });
      const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.31', {
        'accept-encoding': 'gzip, deflate, br',
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers.vary).toBe('Accept-Encoding');
      expect(gunzipSync(res.rawPayload).toString('utf8')).toBe(TEXTS[format]);
      expect(res.headers['content-type']).toBe(TYPES[format]);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="pokatim-route.${format}"; filename*=UTF-8''${encodeURIComponent('Круг')}.${format}`,
      );
    },
  );

  it('gzip в БД, без Accept-Encoding / gzip;q=0 / identity → без Content-Encoding, тело — несжатый файл, Vary есть (AC3)', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT, FILES, { gzip: true });
    for (const headers of [
      {} as Record<string, string>,
      { 'accept-encoding': 'gzip;q=0' },
      { 'accept-encoding': 'identity' },
    ]) {
      for (const format of ['gpx', 'kml', 'tcx'] as const) {
        const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.32', headers);
        const label = `${format} ${JSON.stringify(headers)}`;
        expect(res.statusCode, label).toBe(200);
        expect(res.headers['content-encoding'], label).toBeUndefined();
        expect(res.headers.vary, label).toBe('Accept-Encoding');
        expect(res.body, label).toBe(TEXTS[format]);
      }
    }
  });

  it('старый документ без encoding: Accept-Encoding: gzip → тело как есть, без Content-Encoding (AC4)', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT, FILES);
    for (const format of ['gpx', 'kml', 'tcx'] as const) {
      const res = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.33', {
        'accept-encoding': 'gzip',
      });
      expect(res.statusCode, format).toBe(200);
      expect(res.headers['content-encoding'], format).toBeUndefined();
      expect(res.body, format).toBe(TEXTS[format]);
    }
  });

  it('повреждённый gzip в БД → 500 JSON без Content-Disposition; с Accept-Encoding: gzip — байты как есть', async () => {
    const id = await seedRoute();
    await seedDerived(id, null, GPX_TEXT, FILES, { gzip: true });
    const broken = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    await routesDb(h).exports.updateOne({ _id: id }, { $set: { gpx: new Binary(broken) } });
    const res = await getRaw(`/v1/routes/${id}/gpx`, '198.51.100.34');
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('новый маршрут после разбора: /gpx с gzip и без — один и тот же XML', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token, 'route-trk-no-time.gpx', 'Холмы');
    expect(
      (
        await panelCall(h, org.token, 'POST', `${ROUTES}/${id}/publish`, {
          city: 'minsk',
          surfaces: ['asphalt'],
        })
      ).status,
    ).toBe(200);
    for (const format of ['gpx', 'kml', 'tcx'] as const) {
      const zipped = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.35', {
        'accept-encoding': 'gzip',
      });
      const plain = await getRaw(`/v1/routes/${id}/${format}`, '198.51.100.35');
      expect(zipped.headers['content-encoding'], format).toBe('gzip');
      expect(plain.headers['content-encoding'], format).toBeUndefined();
      expect(gunzipSync(zipped.rawPayload).toString('utf8'), format).toBe(plain.body);
      expect(plain.body, format).toMatch(/^<\?xml/);
    }
  });
});

describe('изоляция маршрутов райдера (routes-02, RC-2)', () => {
  /** Защита в глубину: каталог у маршрута райдера подставлен в БД вручную (приложение его не ставит). */
  const riderInCatalog = () =>
    seedRiderRoute(h, uuidv7(), {
      catalog: { city: 'brest', surfaces: ['asphalt'], publishedAt: h.clock.now() },
    });

  it('публично: нет в списке и городах; карточка, карта и GPX — 404 (даже с подставленным catalog)', async () => {
    const platform = await seedRoute({ city: 'minsk' });
    const rider = await riderInCatalog();
    const plain = await seedRiderRoute(h, uuidv7());

    expect(await ids()).toEqual([platform]);
    expect(await ids('?city=brest')).toEqual([]);
    expect(CatalogRouteCities.parse((await get('/v1/routes/cities')).body).cities).toEqual([
      'minsk',
    ]);
    for (const id of [rider, plain]) {
      for (const suffix of ['', '/map', '/gpx', '/kml', '/tcx']) {
        const res = await get(`/v1/routes/${id}${suffix}`);
        expect(res.status, `${id}${suffix}`).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
  });

  it('порты races/results: готовый маршрут райдера — не коридор, нет геометрии сверки, рамки, линии показа и названия', async () => {
    const rider = await riderInCatalog();
    const catalog = h.app.get<RouteCatalog>(ROUTE_CATALOG, { strict: false });
    const geometry = h.app.get<RouteGeometry>(ROUTE_GEOMETRY, { strict: false });
    expect(await catalog.findReady(rider)).toBeNull();
    expect(await catalog.inCatalog(rider)).toBe(false);
    expect((await catalog.summaries([rider])).size).toBe(0);
    expect(await geometry.matchGeometry(rider)).toBeNull();
    expect(await geometry.bounds(rider)).toBeNull();
    expect(await geometry.displayGeometry(rider)).toBeNull();
  });
});

describe('маршруты райдеров в каталоге (routes-06)', () => {
  const RIDER_HIDDEN = /ownerUserId|"origin"|publication|showAuthorName|submissionCount|version/;

  it('N1: pending, rejected, hidden, withdrawn, без заявки — нет в списке и городах; карточка, карта, GPX, гонки — 404 (даже с подставленным catalog)', async () => {
    const platform = await seedRoute({ city: 'minsk' });
    const catalog = {
      city: 'brest' as const,
      surfaces: ['gravel' as const],
      publishedAt: h.clock.now(),
    };
    const owner = uuidv7();
    const states = await Promise.all(
      (['pending', 'rejected', 'hidden', 'withdrawn'] as const).map((status) =>
        seedRiderRoute(h, owner, { publication: publicationDoc(h, status), catalog }),
      ),
    );
    const never = await seedRiderRoute(h, owner, { catalog });
    for (const id of [...states, never]) {
      await seedDerived(id, null, GPX_TEXT);
    }

    expect(await ids()).toEqual([platform]);
    expect(await ids('?author=rider')).toEqual([]);
    expect(CatalogRouteCities.parse((await get('/v1/routes/cities')).body).cities).toEqual([
      'minsk',
    ]);
    for (const id of [...states, never]) {
      for (const suffix of ['', '/map', '/gpx', '/kml', '/tcx', '/races']) {
        const res = await get(`/v1/routes/${id}${suffix}`);
        expect(res.status, `${id}${suffix}`).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
  });

  it('approved — в списке, городах, карточке, карте и GPX с author rider; «Гонки на маршруте» — 404 (RC-1); ключи — контрактные', async () => {
    const t = h.clock.now().getTime();
    const platform = await seedRoute({ city: 'minsk', publishedAt: new Date(t - MINUTE) });
    const rider = await seedApprovedRiderRoute(h, uuidv7(), {
      city: 'gomel',
      surfaces: ['gravel'],
    });
    await seedDerived(rider, null, GPX_TEXT);

    const list = await get('/v1/routes');
    expect(
      (list.body as { items: object[] }).items.map((item) => Object.keys(item).sort()),
    ).toEqual([CARD_KEYS, CARD_KEYS]);
    expect(JSON.stringify(list.body)).not.toMatch(RIDER_HIDDEN);
    expect(JSON.stringify(list.body)).not.toMatch(HIDDEN);
    const items = CatalogRoutePage.parse(list.body).items;
    expect(items.map((item) => [item.id, item.author])).toEqual([
      [rider, { kind: 'rider', name: null }],
      [platform, { kind: 'team' }],
    ]);
    expect(CatalogRouteCities.parse((await get('/v1/routes/cities')).body).cities.sort()).toEqual([
      'gomel',
      'minsk',
    ]);

    const detail = await get(`/v1/routes/${rider}`);
    expect(detail.status).toBe(200);
    expect(Object.keys(detail.body as object).sort()).toEqual(DETAIL_KEYS);
    expect(JSON.stringify(detail.body)).not.toMatch(RIDER_HIDDEN);
    expect(CatalogRouteDetail.parse(detail.body)).toMatchObject({
      id: rider,
      city: 'gomel',
      surfaces: ['gravel'],
      author: { kind: 'rider', name: null },
      gpxAvailable: true,
    });
    const map = await get(`/v1/routes/${rider}/map`);
    expect(map.status).toBe(200);
    expect(Object.keys(map.body as object).sort()).toEqual(['bounds', 'finish', 'line', 'start']);
    expect((await getRaw(`/v1/routes/${rider}/gpx`, '198.51.100.9')).statusCode).toBe(200);
    expect((await get(`/v1/routes/${rider}/races`)).status).toBe(404);
    expect((await get(`/v1/routes/${platform}/races`)).status).toBe(200);
  });

  it('карта маршрута райдера — без кэша геометрии портов (порт не вызывается; после удаления — 404 сразу)', async () => {
    const owner = uuidv7();
    const rider = await seedApprovedRiderRoute(h, owner);
    const port = h.app.get<RouteGeometry>(ROUTE_GEOMETRY, { strict: false });
    const spy = vi.spyOn(port, 'displayGeometry');
    try {
      expect((await get(`/v1/routes/${rider}/map`)).status).toBe(200);
      expect(spy).not.toHaveBeenCalled();
      await routesDb(h).routes.deleteOne({ _id: rider });
      await routesDb(h).geometries.deleteOne({ _id: rider });
      expect((await get(`/v1/routes/${rider}/map`)).status).toBe(404);
      // маршрут команды по-прежнему через порт (кэш)
      const platform = await seedRoute();
      expect((await get(`/v1/routes/${platform}/map`)).status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await port.displayGeometry(rider)).toBeNull();
  });

  it('фильтр «Автор» × город × дистанция × покрытие × курсор (AC6); IXSCAN routes_catalog_idx без SORT', async () => {
    const t = h.clock.now().getTime();
    let n = 0;
    const at = () => new Date(t - ++n * MINUTE);
    const owner = uuidv7();
    const team1 = await seedRoute({ city: 'minsk', surfaces: ['asphalt'], publishedAt: at() });
    const rider1 = await seedApprovedRiderRoute(h, owner, {
      city: 'minsk',
      surfaces: ['asphalt'],
      approvedAt: at(),
    });
    const team2 = await seedRoute({ city: 'brest', surfaces: ['gravel'], publishedAt: at() });
    const rider2 = await seedApprovedRiderRoute(h, owner, {
      city: 'minsk',
      surfaces: ['gravel'],
      approvedAt: at(),
    });
    const rider3 = await seedApprovedRiderRoute(h, owner, {
      city: 'minsk',
      surfaces: ['asphalt'],
      approvedAt: at(),
    });

    expect(await ids()).toEqual([team1, rider1, team2, rider2, rider3]);
    expect(await ids('?author=team')).toEqual([team1, team2]);
    expect(await ids('?author=rider')).toEqual([rider1, rider2, rider3]);
    expect(await ids('?author=team&author=rider')).toEqual([team1, rider1, team2, rider2, rider3]);
    expect(await ids('?author=rider&city=minsk&surface=asphalt')).toEqual([rider1, rider3]);
    expect(await ids('?author=team&city=minsk')).toEqual([team1]);
    expect(await ids('?author=rider&distance=gt100')).toEqual([]);
    expect(await ids('?author=rider&distance=lt50')).toEqual([rider1, rider2, rider3]);

    const seen: string[] = [];
    let cursor: string | null = null;
    await h.db.command({ profile: 2 });
    try {
      do {
        const next: CatalogRoutePage = await page(
          `?author=rider&city=minsk&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...next.items.map((item) => item.id));
        cursor = next.nextCursor;
      } while (cursor && seen.length < 10);
    } finally {
      await h.db.command({ profile: 0 });
    }
    expect(seen).toEqual([rider1, rider2, rider3]);
    const entries = await h.db
      .collection<{ planSummary?: string; hasSortStage?: boolean }>('system.profile')
      .find({ ns: `${h.db.databaseName}.routes`, op: 'query', 'command.sort': { $exists: true } })
      .toArray();
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) {
      expect(entry.planSummary).toContain('IXSCAN { catalog.publishedAt: -1, _id: -1 }');
      expect(entry.hasSortStage ?? false).toBe(false);
    }
    for (const broken of ['author=platform', 'author=team&author=rider&author=team']) {
      expect((await get(`/v1/routes?${broken}`)).status, broken).toBe(400);
    }
  });

  it('N8: имя — только с галочкой и публичным именем (без условия согласия «в результатах»); без галочки или без имени — null', async () => {
    const profiles = h.db.collection<Record<string, unknown> & { _id: string }>('profiles');
    const [unsigned, nameless, signed] = [uuidv7(), uuidv7(), uuidv7()];
    await profiles.insertMany([
      { _id: unsigned, rideReasons: [], surveyCompletedAt: null, publicName: 'Скрытый' },
      { _id: nameless, rideReasons: [], surveyCompletedAt: null, publicName: null },
      {
        _id: signed,
        rideReasons: [],
        surveyCompletedAt: null,
        publicName: 'Анна К.',
        showNameInResults: false,
      },
    ]);
    const t = h.clock.now().getTime();
    const a = await seedApprovedRiderRoute(h, unsigned, {
      showAuthorName: false,
      approvedAt: new Date(t - MINUTE),
    });
    const b = await seedApprovedRiderRoute(h, nameless, {
      showAuthorName: true,
      approvedAt: new Date(t - 2 * MINUTE),
    });
    const c = await seedApprovedRiderRoute(h, signed, {
      showAuthorName: true,
      approvedAt: new Date(t - 3 * MINUTE),
    });

    const items = (await page()).items;
    expect(items.map((item) => [item.id, item.author])).toEqual([
      [a, { kind: 'rider', name: null }],
      [b, { kind: 'rider', name: null }],
      [c, { kind: 'rider', name: 'Анна К.' }],
    ]);
    expect(CatalogRouteDetail.parse((await get(`/v1/routes/${a}`)).body).author).toEqual({
      kind: 'rider',
      name: null,
    });
    expect(CatalogRouteDetail.parse((await get(`/v1/routes/${c}`)).body).author).toEqual({
      kind: 'rider',
      name: 'Анна К.',
    });
    expect(JSON.stringify((await get('/v1/routes')).body)).not.toContain('Скрытый');

    // сброс имени — виден на следующем запросе (не снимок)
    await profiles.updateOne({ _id: signed }, { $set: { publicName: null } });
    expect(CatalogRouteDetail.parse((await get(`/v1/routes/${c}`)).body).author).toEqual({
      kind: 'rider',
      name: null,
    });
  });
});
