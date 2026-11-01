import { RouteRideLeaderboard, RouteRidePage } from '@pokatim/contracts';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { daysAgo } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  autoEvents,
  catalogCorridorRoute,
  outboxJob,
  ownCorridorRoute,
  ridesUrl,
  routeRidesDb,
  routeRidesRepository,
} from '../../../test/route-rides';
import { seedRouteRide } from '../../../test/route-ride-seed';
import { rideGpx, rider, uploadRide } from '../../../test/results';
import { routesDb } from '../../../test/routes';
import { RouteRideAutoProcessor } from './route-ride-auto.processor';
import { RouteRidesRepository } from './route-rides.repository';
import { ROUTE_RIDE_DELETE_POLICY } from './route-rides.policy';

/**
 * Удаление своего заезда по маршруту (route-rides-07, AC1–AC5): HTTP через стенд; заезды — прямой вставкой поверх
 * живых активностей, автозаезд — `RouteRideAutoProcessor.process` по событию outbox.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
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

const TEAM = '01890a5d-ac96-774b-bcce-b30209900002';
const UNKNOWN = '01890a5d-ac96-774b-bcce-b30209900099';

type Auth = Record<string, string>;
const remove = (auth: Auth | undefined, routeId: string, rideId: string) =>
  call(h, 'POST', ridesUrl(routeId, `/${rideId}/delete`), {}, auth);
const get = (auth: Auth, url: string) => call(h, 'GET', url, undefined, auth);
async function page(auth: Auth, routeId: string) {
  const res = await get(auth, ridesUrl(routeId));
  expect(res.status).toBe(200);
  return RouteRidePage.parse(res.body);
}

describe('POST /v1/routes/:routeId/rides/:rideId/delete', () => {
  it('AC1: свой заезд → 204, нет в списке, деталь и трек — 404, лучший — следующий; повтор — 404', async () => {
    const me = await rider(h);
    const routeId = await catalogCorridorRoute(h, TEAM);
    const best = await seedRouteRide(h, me.userId, routeId, 900, daysAgo(h, 3));
    const next = await seedRouteRide(h, me.userId, routeId, 1000, daysAgo(h, 2));

    const res = await remove(me.auth, routeId, best.rideId);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    const after = await page(me.auth, routeId);
    expect(after.items.map((item) => item.id)).toEqual([next.rideId]);
    expect(after.summary).toMatchObject({ count: 1, best: { id: next.rideId, elapsedSec: 1000 } });
    expect((await get(me.auth, ridesUrl(routeId, `/${best.rideId}`))).status).toBe(404);
    expect((await get(me.auth, ridesUrl(routeId, `/${best.rideId}/track`))).status).toBe(404);
    expect(await routeRidesDb(h).rides.countDocuments({ _id: best.rideId })).toBe(0);

    expect((await remove(me.auth, routeId, best.rideId)).status).toBe(404);
  });

  it('AC2: чужой заезд, неизвестный, заезд другого маршрута, невидимый маршрут — 404; без токена — 401; не UUID — 400', async () => {
    const me = await rider(h);
    const stranger = await rider(h, 'stranger@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    const otherRoute = await catalogCorridorRoute(h, TEAM);
    const theirs = await seedRouteRide(h, stranger.userId, routeId, 900, daysAgo(h, 2));
    const mine = await seedRouteRide(h, me.userId, routeId, 900, daysAgo(h, 2));

    expect((await remove(me.auth, routeId, theirs.rideId)).status).toBe(404);
    expect((await remove(me.auth, routeId, UNKNOWN)).status).toBe(404);
    expect((await remove(me.auth, otherRoute, mine.rideId)).status).toBe(404);
    expect((await remove(undefined, routeId, mine.rideId)).status).toBe(401);
    expect((await remove(me.auth, routeId, 'not-a-uuid')).status).toBe(400);

    // маршрут снят из каталога — невидим: 404, заезд цел (вернётся с повторной публикацией)
    await routesDb(h).routes.updateOne({ _id: routeId }, { $set: { catalog: null } });
    expect((await remove(me.auth, routeId, mine.rideId)).status).toBe(404);
    expect(await routeRidesDb(h).rides.countDocuments({})).toBe(2);
  });

  it('AC3: лимит исчерпан → 429 RATE_LIMITED (до чтений)', async () => {
    const me = await rider(h);
    const routeId = await catalogCorridorRoute(h, TEAM);
    const limiter = h.app.get(RateLimiter);
    const { userLimit } = ROUTE_RIDE_DELETE_POLICY;
    for (let i = 0; i < userLimit.limit; i += 1) {
      await limiter.consume(`route-rides-delete:${me.userId}`, userLimit, h.clock.now());
    }
    const res = await remove(me.auth, routeId, UNKNOWN);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('AC4: «Другие» — строка райдера по следующему лучшему; удалён единственный — строки нет', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    for (const who of [me, anna]) {
      const res = await call(h, 'PATCH', '/v1/profile', { showRouteRides: true }, who.auth);
      expect(res.status).toBe(200);
    }
    const fast = await seedRouteRide(h, anna.userId, routeId, 800, daysAgo(h, 3));
    const slow = await seedRouteRide(h, anna.userId, routeId, 1200, daysAgo(h, 2));
    await seedRouteRide(h, me.userId, routeId, 1000, daysAgo(h, 2));
    const board = async () => {
      const res = await get(me.auth, ridesUrl(routeId, '/leaderboard'));
      expect(res.status).toBe(200);
      const table = RouteRideLeaderboard.parse(res.body);
      return { rows: table.rows.map((row) => row.elapsedSec), me: table.me?.elapsedSec ?? null };
    };
    expect(await board()).toEqual({ rows: [800, 1000], me: 1000 });

    expect((await remove(anna.auth, routeId, fast.rideId)).status).toBe(204);
    expect(await board()).toEqual({ rows: [1000, 1200], me: 1000 });
    expect((await remove(anna.auth, routeId, slow.rideId)).status).toBe(204);
    expect(await board()).toEqual({ rows: [1000], me: 1000 });
  });

  it('AC5: удалённый автозаезд не воскресает от повтора события; маршрут снят из планов райдера', async () => {
    const me = await rider(h);
    const own = await ownCorridorRoute(h, me.userId);
    const upload = await uploadRide(h, me.auth, rideGpx('clean.gpx', daysAgo(h, 1)));
    expect(upload.outcome).toBe('ready');
    const [event] = (await autoEvents(h)).filter(
      (item) => (item.payload as { activityId: string }).activityId === upload.activityId,
    );
    const auto = h.worker.get(RouteRideAutoProcessor);
    expect(await auto.process(outboxJob(event!.type, event!._id))).toEqual({
      planned: 1,
      passed: 1,
    });
    const created = await routeRidesDb(h).rides.findOne({ routeId: own });

    expect((await remove(me.auth, own, created!._id)).status).toBe(204);
    expect(await routeRidesDb(h).autoPlans.findOne({ _id: event!._id })).toMatchObject({
      routeIds: [],
    });
    expect(await auto.process(outboxJob(event!.type, event!._id, 1))).toEqual({
      planned: 0,
      passed: 0,
    });
    expect(await routeRidesDb(h).rides.countDocuments({ routeId: own })).toBe(0);
  });

  it('AC5: удаление во время повторного прогона (план уже прочитан) — заезд не создан снова', async () => {
    const me = await rider(h);
    const own = await ownCorridorRoute(h, me.userId);
    const upload = await uploadRide(h, me.auth, rideGpx('clean.gpx', daysAgo(h, 1)));
    const [event] = (await autoEvents(h)).filter(
      (item) => (item.payload as { activityId: string }).activityId === upload.activityId,
    );
    const auto = h.worker.get(RouteRideAutoProcessor);
    await auto.process(outboxJob(event!.type, event!._id));
    const created = await routeRidesDb(h).rides.findOne({ routeId: own });

    // повтор: план прочитан, затем райдер удаляет заезд — процессор доходит до маршрута, заезда нет
    const repository = routeRidesRepository(h);
    const planOf = repository.autoPlanOf.bind(repository);
    vi.spyOn(repository, 'autoPlanOf').mockImplementationOnce(async (id) => {
      const plan = await planOf(id);
      expect((await remove(me.auth, own, created!._id)).status).toBe(204);
      return plan;
    });
    expect(await auto.process(outboxJob(event!.type, event!._id, 1))).toEqual({
      planned: 1,
      passed: 0,
    });
    expect(await routeRidesDb(h).rides.countDocuments({ routeId: own })).toBe(0);
  });

  it('AC5: ручной заезд той же активности создан и удалён после последних проверок прогона — автозаезда нет', async () => {
    const me = await rider(h);
    const own = await ownCorridorRoute(h, me.userId);
    const upload = await uploadRide(h, me.auth, rideGpx('clean.gpx', daysAgo(h, 1)));
    const [event] = (await autoEvents(h)).filter(
      (item) => (item.payload as { activityId: string }).activityId === upload.activityId,
    );
    const repository = routeRidesRepository(h);
    const mark = repository.markPlannedInsert.bind(repository);
    vi.spyOn(repository, 'markPlannedInsert').mockImplementationOnce(async (tx, id, routeId) => {
      // окно между проверками процессора и вставкой: ручной заезд той же активности и его удаление
      const manual = await seedRouteRide(h, me.userId, routeId, 900, daysAgo(h, 1), {
        activityId: upload.activityId!,
      });
      expect((await remove(me.auth, routeId, manual.rideId)).status).toBe(204);
      return mark(tx, id, routeId);
    });
    const auto = h.worker.get(RouteRideAutoProcessor);
    expect(await auto.process(outboxJob(event!.type, event!._id))).toEqual({
      planned: 1,
      passed: 0,
    });
    expect(await routeRidesDb(h).rides.countDocuments({ routeId: own })).toBe(0);
  });

  it('AC5: удаление не закоммичено, когда прогон пишет в план, — конфликт записи, после коммита автозаезда нет', async () => {
    const me = await rider(h);
    const own = await ownCorridorRoute(h, me.userId);
    const upload = await uploadRide(h, me.auth, rideGpx('clean.gpx', daysAgo(h, 1)));
    const [event] = (await autoEvents(h)).filter(
      (item) => (item.payload as { activityId: string }).activityId === upload.activityId,
    );
    // транзакция удаления (API) держится открытой после своих записей, пока её не отпустят
    const api = h.app.get(RouteRidesRepository, { strict: false });
    const deleteOwn = api.deleteOwn.bind(api);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let written!: () => void;
    const wrote = new Promise<void>((resolve) => (written = resolve));
    vi.spyOn(api, 'deleteOwn').mockImplementationOnce(async (...args) => {
      const deleted = await deleteOwn(...args);
      written();
      await gate;
      return deleted;
    });

    const worker = routeRidesRepository(h);
    const mark = worker.markPlannedInsert.bind(worker);
    let deleting: Promise<{ status: number }> | undefined;
    vi.spyOn(worker, 'markPlannedInsert').mockImplementationOnce(async (tx, id, routeId) => {
      // заезд другой активности по тому же маршруту: уникальный ключ не пересекается со вставкой — сериализует
      // только запись в план
      const manual = await seedRouteRide(h, me.userId, routeId, 900, daysAgo(h, 2));
      deleting = remove(me.auth, routeId, manual.rideId);
      await wrote;
      setTimeout(release, 300);
      // запись в план под незакоммиченным `$pull` — конфликт; повтор транзакции видит план без маршрута
      return mark(tx, id, routeId);
    });
    const auto = h.worker.get(RouteRideAutoProcessor);
    expect(await auto.process(outboxJob(event!.type, event!._id))).toEqual({
      planned: 1,
      passed: 0,
    });
    expect((await deleting!).status).toBe(204);
    expect(await routeRidesDb(h).rides.countDocuments({ routeId: own })).toBe(0);
  });
});
