import { createHash } from 'node:crypto';

import { MyRoute, MyRoutePage, RouteMapGeometry } from '@pokatim/contracts';
import { Binary } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { bearer, call, outboxEvents, signUpSession, userIdByEmail } from '../../../test/identity';
import { panel, panelSession, seedMember } from '../../../test/panel';
import {
  fixture,
  expectedFixtures,
  MY_ROUTES,
  parsedMyRoute,
  parsedRoute,
  processRoute,
  routesDb,
  routesRepository,
  seedRiderRoute,
  uploadMyRoute,
  uploadRoute,
} from '../../../test/routes';
import { heldUpload } from '../../../test/uploads';
import { ROUTE_RECEIVED } from './routes.events';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

/**
 * Мои маршруты (routes-02, AC1–AC5): приём GPX/KML райдером, лимиты, квота, дедуп, список, карточка, карта,
 * переименование, удаление (в т. ч. во время обработки), чужие — 404, состав ответа, `no-store`, `explain` списка.
 * Разбор — `processRoute` напрямую (как задача по событию outbox).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const MY_ROUTE_KEYS = Object.keys(MyRoute.shape).sort();
const HIDDEN = /ownerUserId|sha256|"origin"|attempts|catalog|matchLine|sizeBytes|updatedAt/;

/** Райдер приложения: токен доступа и id. */
async function rider(email = 'rider@example.com') {
  const session = await signUpSession(h, email);
  return { token: session.accessToken, userId: await userIdByEmail(h, email) };
}

const get = (token: string | undefined, url: string) =>
  call(h, 'GET', url, undefined, token ? bearer(token) : {});
const post = (token: string | undefined, url: string, body: unknown = {}) =>
  call(h, 'POST', url, body, token ? bearer(token) : {});
const routeDoc = (id: string) => routesDb(h).routes.findOne({ _id: id });
/** Байты GPX с уникальным хвостом (другой sha256). */
const variant = (name: string, i: number) =>
  Buffer.concat([fixture(name), Buffer.from(`<!-- ${i} -->`)]);

describe('приём и разбор (AC1, AC2)', () => {
  it('GPX → 202 processing (ключи контракта, no-store, без журнала панели) → worker → ready; повтор файла — 200 тот же', async () => {
    const me = await rider();
    const first = await uploadMyRoute(h, me.token, fixture('route-trk-no-time.gpx'), '  Кольцо  ');
    expect(first.status).toBe(202);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(Object.keys(first.body as object).sort()).toEqual(MY_ROUTE_KEYS);
    expect(JSON.stringify(first.body)).not.toMatch(HIDDEN);
    const route = parsedMyRoute(first);
    expect(route).toMatchObject({ title: 'Кольцо', status: 'processing', distanceM: null });
    expect(await routeDoc(route.id)).toMatchObject({ origin: 'rider', ownerUserId: me.userId });
    expect(await panel(h).audit.countDocuments()).toBe(0);
    const events = (await outboxEvents(h)).filter((event) => event.type === ROUTE_RECEIVED);
    expect(events.map((event) => event.payload)).toEqual([{ routeId: route.id }]);

    expect(await processRoute(h, route.id)).toBe('ready');
    const read = await get(me.token, `${MY_ROUTES}/${route.id}`);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(Object.keys(read.body as object).sort()).toEqual(MY_ROUTE_KEYS);
    const ready = parsedMyRoute(read);
    const ref = expectedFixtures['route-trk-no-time.gpx']!;
    expect(ready.status).toBe('ready');
    expect(Math.abs(ready.distanceM! - ref.distanceM)).toBeLessThan(1);
    expect(ready.isLoop).toBe(false);

    const again = await uploadMyRoute(h, me.token, fixture('route-trk-no-time.gpx'), 'Другое');
    expect(again.status).toBe(200);
    expect(parsedMyRoute(again)).toMatchObject({ id: route.id, title: 'Кольцо' });
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
  });

  it('KML (My Maps, Earth gx:Track) → ready; пустой KML → failed: no_track, повтор файла — 202 снова в обработке', async () => {
    const me = await rider();
    for (const name of ['route-mymaps.kml', 'route-earth-gxtrack.kml']) {
      const res = await uploadMyRoute(h, me.token, fixture(name), name);
      expect(res.status, name).toBe(202);
      const { id } = parsedMyRoute(res);
      expect(await processRoute(h, id)).toBe('ready');
      const ready = parsedMyRoute(await get(me.token, `${MY_ROUTES}/${id}`));
      expect(Math.abs(ready.distanceM! - expectedFixtures[name]!.distanceM)).toBeLessThan(1);
    }
    const empty = parsedMyRoute(await uploadMyRoute(h, me.token, fixture('empty.kml'), 'Пусто'));
    expect(await processRoute(h, empty.id)).toBe('failed');
    expect(parsedMyRoute(await get(me.token, `${MY_ROUTES}/${empty.id}`))).toMatchObject({
      status: 'failed',
      failure: 'no_track',
    });
    const retry = await uploadMyRoute(h, me.token, fixture('empty.kml'), 'Пусто');
    expect(retry.status).toBe(202);
    expect(parsedMyRoute(retry)).toMatchObject({ id: empty.id, status: 'processing' });
  });

  it('KMZ, FIT, TCX, XXE — 415; > 5 МиБ — 413 и Connection: close; пусто, без названия, 2 символа — 400', async () => {
    const me = await rider();
    const tcx = Buffer.from(
      '<?xml version="1.0"?><TrainingCenterDatabase></TrainingCenterDatabase>',
    );
    for (const bytes of [
      fixture('route.kmz'),
      fixture('garmin-edge-ride.fit'),
      tcx,
      fixture('xxe.kml'),
    ]) {
      const res = await uploadMyRoute(h, me.token, bytes);
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ code: 'ROUTE_FORMAT_UNSUPPORTED' });
    }
    const large = await uploadMyRoute(h, me.token, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ code: 'ROUTE_TOO_LARGE' });
    expect(large.headers['connection']).toBe('close');
    expect((await uploadMyRoute(h, me.token, Buffer.alloc(0))).status).toBe(400);
    const noTitle = await uploadMyRoute(h, me.token, fixture('route-rte.gpx'), null);
    expect(noTitle.status).toBe(400);
    expect(noTitle.body).toMatchObject({
      details: { fields: [{ path: 'title', code: 'REQUIRED' }] },
    });
    const short = await uploadMyRoute(h, me.token, fixture('route-rte.gpx'), 'ab');
    expect(short.body).toMatchObject({
      details: { fields: [{ path: 'title', code: 'TOO_SHORT' }] },
    });
    expect(await routesDb(h).routes.countDocuments()).toBe(0);
  });

  it('21-я загрузка за час — 429 с Retry-After до чтения тела (тело больше лимита — не 413)', async () => {
    const me = await rider();
    for (let i = 0; i < 20; i += 1) {
      expect((await uploadMyRoute(h, me.token, variant('route-rte.gpx', i))).status).toBe(202);
    }
    const limited = await uploadMyRoute(h, me.token, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(await routesDb(h).routes.countDocuments()).toBe(20);
  });

  it('квота: 100 своих — новый файл 409 ROUTE_QUOTA_EXCEEDED; тот же файл — 200; маршруты других не считаются', async () => {
    const me = await rider();
    const other = await rider('other@example.com');
    const bytes = fixture('route-rte.gpx');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await seedRiderRoute(h, me.userId, { sha256 });
    for (let i = 1; i < 100; i += 1) await seedRiderRoute(h, me.userId, { status: 'failed' });

    const quota = await uploadMyRoute(h, me.token, fixture('route-loop.gpx'));
    expect(quota.status).toBe(409);
    expect(quota.body).toMatchObject({ code: 'ROUTE_QUOTA_EXCEEDED' });
    const same = await uploadMyRoute(h, me.token, bytes);
    expect(same.status).toBe(200);
    expect(parsedMyRoute(same).id).toBe(existing);
    expect((await uploadMyRoute(h, other.token, fixture('route-loop.gpx'))).status).toBe(202);
  });
});

describe('дедуп между происхождениями (AC5)', () => {
  it('сотрудник: файл маршрута команды в приложении — новый маршрут райдера; снова в панели — маршрут команды', async () => {
    const session = await signUpSession(h, 'org@example.by');
    const userId = await userIdByEmail(h, 'org@example.by');
    await seedMember(h, userId, 'organizer');
    const panelToken = await panelSession(h, 'org@example.by');
    const bytes = fixture('route-rte.gpx');

    const platform = parsedRoute(await uploadRoute(h, panelToken, bytes));
    const mine = await uploadMyRoute(h, session.accessToken, bytes);
    expect(mine.status).toBe(202);
    expect(parsedMyRoute(mine).id).not.toBe(platform.id);
    expect(await routeDoc(parsedMyRoute(mine).id)).toMatchObject({ origin: 'rider' });
    const again = await uploadRoute(h, panelToken, bytes);
    expect(again.status).toBe(200);
    expect(parsedRoute(again).id).toBe(platform.id);
  });

  it('одновременная двойная загрузка райдера — один маршрут (дубль ключа routes_owner_origin_sha_unique)', async () => {
    const me = await rider();
    const bytes = fixture('route-rte.gpx');
    const first = parsedMyRoute(await uploadMyRoute(h, me.token, bytes));
    const lookup = vi.spyOn(routesRepository(h), 'findByOwnerSha').mockResolvedValueOnce(undefined);
    const raced = await uploadMyRoute(h, me.token, bytes);
    expect(lookup).toHaveBeenCalled();
    expect(raced.status).toBe(200);
    expect(parsedMyRoute(raced).id).toBe(first.id);
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
    expect(await routesDb(h).sources.countDocuments()).toBe(1);
  });
});

describe('список, карточка, карта', () => {
  it('только свои маршруты райдера, новые сверху; курсор по 2 на 5 без дублей; IXSCAN routes_owner_origin_idx без SORT', async () => {
    const me = await rider();
    const other = await rider('other@example.com');
    const mine: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      mine.unshift(await seedRiderRoute(h, me.userId, { status: i % 2 ? 'processing' : 'ready' }));
      h.clock.advance(MINUTE);
    }
    await seedRiderRoute(h, other.userId);
    // маршрут команды того же пользователя (сотрудник) в «моих» не виден
    const platform = await seedRiderRoute(h, me.userId);
    await routesDb(h).routes.updateOne({ _id: platform }, { $set: { origin: 'platform' } });

    const first = await get(me.token, `${MY_ROUTES}?limit=2`);
    expect(first.headers['cache-control']).toBe('no-store');
    const seen: string[] = [];
    // профиль переживает h.reset: записи explain-тестов других файлов не нужны
    await h.db
      .collection('system.profile')
      .drop()
      .catch(() => undefined);
    await h.db.command({ profile: 2 });
    try {
      let cursor: string | null = null;
      do {
        const res = await get(me.token, `${MY_ROUTES}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        const page: MyRoutePage = MyRoutePage.parse(res.body);
        for (const item of (res.body as { items: object[] }).items) {
          expect(Object.keys(item).sort()).toEqual(MY_ROUTE_KEYS);
        }
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor && seen.length < 10);
    } finally {
      await h.db.command({ profile: 0 });
    }
    expect(seen).toEqual(mine);
    const profile = h.db.collection<{ planSummary?: string; hasSortStage?: boolean }>(
      'system.profile',
    );
    const entries = await profile
      .find({ ns: `${h.db.databaseName}.routes`, op: 'query', 'command.sort': { $exists: true } })
      .toArray();
    await profile.drop();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.planSummary).toContain('IXSCAN { ownerUserId: 1, origin: 1, _id: -1 }');
      expect(entry.hasSortStage ?? false).toBe(false);
    }

    for (const query of ['?limit=51', '?status=ready', '?cursor=abc', '?cursor[$ne]=x']) {
      expect((await get(me.token, `${MY_ROUTES}${query}`)).status, query).toBe(400);
    }
  });

  it('карта готового — ровно bounds, finish, line, start; не готового — 404; маршрут команды того же пользователя — 404', async () => {
    const me = await rider();
    const ready = await seedRiderRoute(h, me.userId);
    const processing = await seedRiderRoute(h, me.userId, { status: 'processing' });
    const map = await get(me.token, `${MY_ROUTES}/${ready}/map`);
    expect(map.status).toBe(200);
    expect(map.headers['cache-control']).toBe('no-store');
    expect(Object.keys(map.body as object).sort()).toEqual(['bounds', 'finish', 'line', 'start']);
    const geometry = RouteMapGeometry.parse(map.body);
    expect(geometry.line).toEqual(
      (await routesDb(h).geometries.findOne({ _id: ready }))!.line.coordinates,
    );
    expect(geometry.bounds).toEqual([27.55, 53.9, 27.57, 53.91]);

    expect((await get(me.token, `${MY_ROUTES}/${processing}/map`)).status).toBe(404);
    await routesDb(h).routes.updateOne({ _id: ready }, { $set: { origin: 'platform' } });
    for (const suffix of ['', '/map']) {
      expect((await get(me.token, `${MY_ROUTES}/${ready}${suffix}`)).status).toBe(404);
    }
    expect((await get(me.token, `${MY_ROUTES}/not-a-uuid`)).status).toBe(400);
  });
});

describe('переименование и удаление (AC3)', () => {
  it('rename → 200 MyRoute, новое название в списке; то же название — без записи; невалидное — 400', async () => {
    const me = await rider();
    const id = await seedRiderRoute(h, me.userId, { status: 'processing' });
    h.clock.advance(MINUTE);
    const renamed = await post(me.token, `${MY_ROUTES}/${id}/rename`, {
      title: '  Вечерний круг ',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.headers['cache-control']).toBe('no-store');
    expect(parsedMyRoute(renamed)).toMatchObject({
      id,
      title: 'Вечерний круг',
      status: 'processing',
    });
    const list = MyRoutePage.parse((await get(me.token, MY_ROUTES)).body);
    expect(list.items.map((item) => item.title)).toEqual(['Вечерний круг']);

    const before = await routeDoc(id);
    h.clock.advance(MINUTE);
    expect(
      (await post(me.token, `${MY_ROUTES}/${id}/rename`, { title: 'Вечерний круг' })).status,
    ).toBe(200);
    expect((await routeDoc(id))?.updatedAt).toEqual(before?.updatedAt);

    for (const body of [{ title: 'ab' }, { title: 'a\nb\nc' }, { title: 'Круг', extra: 1 }, {}]) {
      expect((await post(me.token, `${MY_ROUTES}/${id}/rename`, body)).status).toBe(400);
    }
  });

  it('delete → 204: маршрут, геометрия, исходник и экспорт GPX удалены; повтор — 404; карточка — 404', async () => {
    const me = await rider();
    const id = await seedRiderRoute(h, me.userId);
    // экспорт routes-03 (пишут разбор и бэкфилл)
    await routesDb(h).exports.insertOne({
      _id: id,
      gpx: new Binary(new Uint8Array([60])),
      sizeBytes: 1,
      derivedVersion: 1,
    });
    const deleted = await post(me.token, `${MY_ROUTES}/${id}/delete`);
    expect(deleted.status).toBe(204);
    expect(deleted.headers['cache-control']).toBe('no-store');
    expect(await routesDb(h).routes.countDocuments({ _id: id })).toBe(0);
    expect(await routesDb(h).geometries.countDocuments({ _id: id })).toBe(0);
    expect(await routesDb(h).sources.countDocuments({ _id: id })).toBe(0);
    expect(await routesDb(h).exports.countDocuments({ _id: id })).toBe(0);
    expect((await post(me.token, `${MY_ROUTES}/${id}/delete`)).status).toBe(404);
    expect((await get(me.token, `${MY_ROUTES}/${id}`)).status).toBe(404);
    expect(await panel(h).audit.countDocuments()).toBe(0);
  });

  it('удаление в обработке: после удаления задача — skipped; захват до удаления — skipped без исключения, сирот нет', async () => {
    const me = await rider();
    const queued = parsedMyRoute(await uploadMyRoute(h, me.token, fixture('route-rte.gpx'))).id;
    expect((await post(me.token, `${MY_ROUTES}/${queued}/delete`)).status).toBe(204);
    expect(await processRoute(h, queued)).toBe('skipped');

    const claimed = parsedMyRoute(await uploadMyRoute(h, me.token, fixture('route-loop.gpx'))).id;
    const repository = h.worker.get(RoutesRepository, { strict: false });
    const original = repository.sourceBytes.bind(repository);
    vi.spyOn(repository, 'sourceBytes').mockImplementationOnce(async (id) => {
      expect((await post(me.token, `${MY_ROUTES}/${id}/delete`)).status).toBe(204);
      return original(id);
    });
    expect(await processRoute(h, claimed)).toBe('skipped');
    for (const id of [queued, claimed]) {
      expect(await routesDb(h).routes.countDocuments({ _id: id })).toBe(0);
      expect(await routesDb(h).geometries.countDocuments({ _id: id })).toBe(0);
      expect(await routesDb(h).sources.countDocuments({ _id: id })).toBe(0);
    }
  });
});

describe('доступ (AC4)', () => {
  it('чужой маршрут райдера: GET, карта, rename, delete — 404 NOT_FOUND, документ не изменился', async () => {
    const owner = await rider('owner@example.com');
    const me = await rider();
    const foreign = await seedRiderRoute(h, owner.userId);
    const before = await routeDoc(foreign);
    for (const [method, suffix, body] of [
      ['GET', '', undefined],
      ['GET', '/map', undefined],
      ['POST', '/rename', { title: 'Чужой' }],
      ['POST', '/delete', {}],
    ] as const) {
      const res =
        method === 'GET'
          ? await get(me.token, `${MY_ROUTES}/${foreign}${suffix}`)
          : await post(me.token, `${MY_ROUTES}/${foreign}${suffix}`, body);
      expect(res.status, suffix).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await routeDoc(foreign)).toEqual(before);
    expect(MyRoutePage.parse((await get(me.token, MY_ROUTES)).body).items).toEqual([]);
  });

  it('без входа — 401 на всех шести (GET /v1/routes/mine — не 400 и не публичный ответ)', async () => {
    const owner = await rider('owner@example.com');
    const id = await seedRiderRoute(h, owner.userId);
    expect((await uploadMyRoute(h, undefined, fixture('route-rte.gpx'))).status).toBe(401);
    for (const url of [MY_ROUTES, `${MY_ROUTES}/${id}`, `${MY_ROUTES}/${id}/map`]) {
      const res = await get(undefined, url);
      expect(res.status, url).toBe(401);
    }
    for (const url of [`${MY_ROUTES}/${id}/rename`, `${MY_ROUTES}/${id}/delete`]) {
      expect((await post(undefined, url, { title: 'Круг' })).status, url).toBe(401);
    }
    expect(await routesDb(h).routes.countDocuments({ _id: id })).toBe(1);
  });
});

describe('upload-limits-kml-panel: слоты приёма и таймаут тела (AC1–AC3)', () => {
  const url = `${MY_ROUTES}?title=${encodeURIComponent('Мой маршрут')}`;

  it('второй одновременный приём того же райдера — 429 до тела; другого — 202; после ответа слот свободен', async () => {
    const me = await rider();
    const other = await rider('other@example.com');
    const first = heldUpload(h, url, bearer(me.token));
    await first.held();
    first.write(fixture('route-rte.gpx').subarray(0, 100));

    const second = await uploadMyRoute(h, me.token, variant('route-rte.gpx', 1));
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 5 } });
    expect((await uploadMyRoute(h, other.token, variant('route-rte.gpx', 2))).status).toBe(202);

    expect((await first.finish(fixture('route-rte.gpx').subarray(100))).status).toBe(202);
    expect((await uploadMyRoute(h, me.token, variant('route-rte.gpx', 3))).status).toBe(202);
  });

  it('слот освобождается после 413 и 415', async () => {
    const me = await rider();
    const tooLarge = heldUpload(h, url, bearer(me.token));
    await tooLarge.held();
    expect((await tooLarge.finish(Buffer.alloc(5 * 1024 * 1024 + 1, 0x20))).status).toBe(413);
    expect((await uploadMyRoute(h, me.token, fixture('route.kmz'))).status).toBe(415);
    expect((await uploadMyRoute(h, me.token, fixture('route-rte.gpx'))).status).toBe(202);
  });

  it('тело молчит дольше idleMs — 408 VALIDATION_FAILED, Connection: close, маршрута нет, слот свободен', async () => {
    const me = await rider();
    const saved = { ...ROUTE_POLICY.bodyTimeouts };
    Object.assign(ROUTE_POLICY.bodyTimeouts, { idleMs: 200 });
    try {
      const silent = heldUpload(h, url, bearer(me.token));
      await silent.held();
      silent.write(fixture('route-rte.gpx').subarray(0, 100));
      const timedOut = await silent.response;
      expect(timedOut.status).toBe(408);
      expect(timedOut.headers['connection']).toBe('close');
      expect(timedOut.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ path: 'body', code: 'INVALID' }] },
      });
    } finally {
      Object.assign(ROUTE_POLICY.bodyTimeouts, saved);
    }
    expect(await routesDb(h).routes.countDocuments()).toBe(0);
    expect((await uploadMyRoute(h, me.token, fixture('route-rte.gpx'))).status).toBe(202);
  });
});
