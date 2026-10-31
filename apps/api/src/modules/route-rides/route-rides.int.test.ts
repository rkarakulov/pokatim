import { rm } from 'node:fs/promises';

import { RouteRideCandidates, RouteRideDetail, RouteRidePage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { call, outboxEvents } from '../../../test/identity';
import {
  checkEvents,
  catalogCorridorRoute,
  outboxJob,
  ownCorridorRoute,
  ridesUrl,
  routeRidesDb,
  routeRidesWorker,
} from '../../../test/route-rides';
import { corridorExpected, importRide, rideGpx, rider, uploadRide } from '../../../test/results';
import { publicationDoc, routesDb } from '../../../test/routes';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { fixture, parsedUpload, tracks, uploadTrack } from '../../../test/tracks';
import { TRACK_ACTIVITY_REMOVED } from '../tracks';
import { RouteRideCheckProcessor } from './route-ride-check.processor';
import { RouteRidesIntakeProcessor } from './route-rides-intake.processor';
import type { RouteRideDoc } from './route-rides.collection';

/**
 * Заезд по маршруту (route-rides-01, AC1–AC7, AC9): HTTP через стенд, проверка — `RouteRideCheckProcessor` по событиям
 * outbox (`routeRidesWorker`), заезды — фикстуры коридора со сдвигом времени (`rideGpx`), маршрут — линия эталона.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

/** Заезды — за несколько дней до часов стенда (22.10 09:00 UTC). */
const DAY0 = new Date('2026-10-15T06:00:00Z');
const dayAt = (n: number, minutes = 0) => new Date(DAY0.getTime() + n * DAY + minutes * 60_000);
const OTHER = '01890a5d-ac96-774b-bcce-b30209900002';
const UNKNOWN = '01890a5d-ac96-774b-bcce-b30209900099';
const CLEAN_SEC = corridorExpected.fixtures['clean.gpx']!.expected.elapsedSec!;

type Auth = Record<string, string>;
const get = (auth: Auth, url: string) => call(h, 'GET', url, undefined, auth);
const post = (auth: Auth, routeId: string, body: unknown) =>
  call(h, 'POST', ridesUrl(routeId), body, auth);

async function page(auth: Auth, routeId: string) {
  const res = await get(auth, ridesUrl(routeId));
  expect(res.status).toBe(200);
  return RouteRidePage.parse(res.body);
}
async function detail(auth: Auth, routeId: string, rideId: string) {
  const res = await get(auth, ridesUrl(routeId, `/${rideId}`));
  expect(res.status).toBe(200);
  return RouteRideDetail.parse(res.body);
}
/** Загрузить заезд и проверить по маршруту (201) — id заезда. */
async function checked(auth: Auth, routeId: string, gpx: Buffer) {
  const upload = await uploadRide(h, auth, gpx);
  expect(upload.outcome).toBe('ready');
  const res = await post(auth, routeId, { activityId: upload.activityId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...upload, rideId: RouteRideDetail.parse(res.body).id };
}

describe('AC1–AC2: вердикт движка коридора гонки (±50 м, окно — время заезда)', () => {
  it('clean.gpx по маршруту каталога → 201 queued, одно событие → passed, время эталона, сводка', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const upload = await uploadRide(h, r.auth, rideGpx('clean.gpx', dayAt(0)));
    const res = await post(r.auth, routeId, { activityId: upload.activityId });
    expect(res.status).toBe(201);
    const queued = RouteRideDetail.parse(res.body);
    expect(queued).toMatchObject({ status: 'queued', elapsedSec: null, checkedAt: null });
    expect(await checkEvents(h)).toHaveLength(1);

    expect(await routeRidesWorker(h).drain()).toBe(1);
    const ride = await detail(r.auth, routeId, queued.id);
    expect(ride).toMatchObject({ status: 'passed', reason: null, failure: null });
    expect(Math.abs(ride.elapsedSec! - CLEAN_SEC)).toBeLessThanOrEqual(1);
    const doc = await routeRidesDb(h).rides.findOne({ _id: queued.id });
    expect(ride.routeDistanceM).toBe(doc!.segment!.distanceM);
    expect(doc).toMatchObject({
      corridorWidthM: 50,
      checkRevision: 1,
      engineVersion: corridorExpected.engineVersion,
    });
    expect(ride.comparison).toMatchObject({ isBest: true, deltaToBestSec: 0, previous: null });
    expect((await page(r.auth, routeId)).summary).toEqual({
      count: 1,
      passedCount: 1,
      best: { id: queued.id, elapsedSec: ride.elapsedSec, rideStartedAt: ride.activity.startedAt },
    });
  });

  it('stop-80pct → no_finish, wobble-3pct → off_corridor (без времени, не лучший); window-start-before → passed', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const stop = await checked(r.auth, routeId, rideGpx('stop-80pct.gpx', dayAt(0)));
    const wobble = await checked(r.auth, routeId, rideGpx('wobble-3pct.gpx', dayAt(1)));
    const early = await checked(r.auth, routeId, rideGpx('window-start-before.gpx', dayAt(2)));
    await routeRidesWorker(h).drain();

    expect(await detail(r.auth, routeId, stop.rideId)).toMatchObject({
      status: 'not_passed',
      reason: 'no_finish',
      elapsedSec: null,
      routeDistanceM: null,
    });
    expect(await detail(r.auth, routeId, wobble.rideId)).toMatchObject({
      status: 'not_passed',
      reason: 'off_corridor',
      elapsedSec: null,
    });
    expect(await detail(r.auth, routeId, early.rideId)).toMatchObject({ status: 'passed' });
    const summary = (await page(r.auth, routeId)).summary;
    expect(summary).toMatchObject({ count: 3, passedCount: 1, best: { id: early.rideId } });
  });
});

describe('AC3: видимость маршрута на всех пяти ручках', () => {
  it('свой готовый маршрут → passed; одобренный чужой в каталоге — доступен', async () => {
    const r = await rider(h);
    const own = await ownCorridorRoute(h, r.userId);
    const ride = await checked(r.auth, own, rideGpx('clean.gpx', dayAt(0)));
    await routeRidesWorker(h).drain();
    expect(await detail(r.auth, own, ride.rideId)).toMatchObject({
      status: 'passed',
      route: { id: own, title: 'Мой коридор' },
    });

    const approved = await ownCorridorRoute(h, OTHER, {
      publication: publicationDoc(h, 'approved'),
      catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
    });
    expect((await post(r.auth, approved, { activityId: ride.activityId })).status).toBe(201);
  });

  it('чужой непубличный, свой не готовый, неизвестный, платформа не в каталоге, чужой hidden — 404 везде', async () => {
    const r = await rider(h);
    const upload = await uploadRide(h, r.auth, rideGpx('clean.gpx', dayAt(0)));
    const hidden = [
      await ownCorridorRoute(h, OTHER),
      await ownCorridorRoute(h, r.userId, { status: 'processing' }),
      UNKNOWN,
      await catalogCorridorRoute(h, OTHER).then(async (id) => {
        await routesDb(h).routes.updateOne({ _id: id }, { $set: { catalog: null } });
        return id;
      }),
      await ownCorridorRoute(h, OTHER, { publication: publicationDoc(h, 'hidden') }),
    ];
    const rideId = uuidv7();
    for (const routeId of hidden) {
      for (const res of [
        await get(r.auth, ridesUrl(routeId)),
        await get(r.auth, ridesUrl(routeId, '/candidates')),
        await post(r.auth, routeId, { activityId: upload.activityId }),
        await get(r.auth, ridesUrl(routeId, `/${rideId}`)),
        await get(r.auth, ridesUrl(routeId, `/${rideId}/track`)),
      ]) {
        expect(res.status, routeId).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
    expect(await routeRidesDb(h).rides.countDocuments()).toBe(0);
  });

  it('чужой заезд по видимому маршруту — 404 на деталь и track, в списке и кандидатах чужого его нет', async () => {
    const a = await rider(h);
    const b = await rider(h, 'other-rider@example.com');
    const routeId = await catalogCorridorRoute(h, OTHER);
    const ride = await checked(a.auth, routeId, rideGpx('clean.gpx', dayAt(0)));
    await routeRidesWorker(h).drain();
    for (const res of [
      await get(b.auth, ridesUrl(routeId, `/${ride.rideId}`)),
      await get(b.auth, ridesUrl(routeId, `/${ride.rideId}/track`)),
      await post(b.auth, routeId, { activityId: ride.activityId }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await page(b.auth, routeId)).toMatchObject({ summary: { count: 0 }, items: [] });
    const candidates = await get(b.auth, ridesUrl(routeId, '/candidates'));
    expect(RouteRideCandidates.parse(candidates.body).items).toEqual([]);
  });
});

describe('AC4: сравнение со своими заездами', () => {
  it('два passed разного времени и один not_passed: isBest, дельты, previous; строки — новые сверху', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const slow = await checked(r.auth, routeId, rideGpx('clean.gpx', dayAt(0), { scale: 1.2 }));
    const failed = await checked(r.auth, routeId, rideGpx('stop-80pct.gpx', dayAt(1)));
    const fast = await checked(r.auth, routeId, rideGpx('clean.gpx', dayAt(2)));
    await routeRidesWorker(h).drain();

    const slowRide = await detail(r.auth, routeId, slow.rideId);
    const fastRide = await detail(r.auth, routeId, fast.rideId);
    expect(slowRide.elapsedSec!).toBeGreaterThan(fastRide.elapsedSec!);
    const delta = slowRide.elapsedSec! - fastRide.elapsedSec!;
    expect(fastRide.comparison).toEqual({
      best: {
        id: fast.rideId,
        elapsedSec: fastRide.elapsedSec,
        rideStartedAt: fastRide.activity.startedAt,
      },
      isBest: true,
      deltaToBestSec: 0,
      previous: {
        id: slow.rideId,
        elapsedSec: slowRide.elapsedSec,
        rideStartedAt: slowRide.activity.startedAt,
      },
      deltaToPreviousSec: -delta,
    });
    expect(slowRide.comparison).toMatchObject({
      best: { id: fast.rideId },
      isBest: false,
      deltaToBestSec: delta,
      previous: null,
      deltaToPreviousSec: null,
    });
    expect((await detail(r.auth, routeId, failed.rideId)).comparison).toMatchObject({
      best: { id: fast.rideId },
      isBest: false,
      deltaToBestSec: null,
      previous: { id: slow.rideId },
      deltaToPreviousSec: null,
    });
    const list = await page(r.auth, routeId);
    expect(list.items.map((item) => item.id)).toEqual([fast.rideId, failed.rideId, slow.rideId]);
    expect(list.items.map((item) => item.isBest)).toEqual([true, false, false]);
    expect(list.items[1]).toMatchObject({
      status: 'not_passed',
      reason: 'no_finish',
      elapsedSec: null,
    });
  });
});

describe('AC5: повтор и дубли группы — тот же заезд', () => {
  it('повтор POST → 200 тот же; дубль Garmin по activityId и uploadId — тот же; failed → новая ревизия', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const gpx = rideGpx('clean.gpx', dayAt(0));
    const first = await checked(r.auth, routeId, gpx);
    const again = await post(r.auth, routeId, { activityId: first.activityId });
    expect(again.status).toBe(200);
    expect(RouteRideDetail.parse(again.body).id).toBe(first.rideId);
    expect(await checkEvents(h)).toHaveLength(1);

    const imported = await importRide(h, r.userId, gpx, { hasHeartRate: false, hasPower: true });
    expect(imported.outcome).toBe('ready');
    for (const body of [
      { activityId: imported.activityId },
      { uploadId: imported.uploadId },
      { activityId: first.activityId },
    ]) {
      const res = await post(r.auth, routeId, body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(RouteRideDetail.parse(res.body).id).toBe(first.rideId);
    }
    expect(await checkEvents(h)).toHaveLength(1);
    // route-rides-03: activityId детали — основная группы сейчас (поздний Garmin с мощностью перехватил основную)
    const head = await detail(r.auth, routeId, first.rideId);
    expect(head).toMatchObject({ origin: 'manual' });
    expect(head.activityId).toBe(imported.activityId);
    expect(head.activityId).not.toBe(first.activityId);
    // старый документ без origin — manual
    await routeRidesDb(h).rides.updateOne({ _id: first.rideId }, { $unset: { origin: '' } });
    expect((await detail(r.auth, routeId, first.rideId)).origin).toBe('manual');

    await routeRidesDb(h).rides.updateOne(
      { _id: first.rideId },
      { $set: { status: 'failed', failure: 'storage' } },
    );
    const retry = await post(r.auth, routeId, { activityId: first.activityId });
    expect(retry.status).toBe(200);
    expect(RouteRideDetail.parse(retry.body)).toMatchObject({ id: first.rideId, status: 'queued' });
    expect(await routeRidesDb(h).rides.findOne({ _id: first.rideId })).toMatchObject({
      checkRevision: 2,
      failure: null,
    });
    expect(await checkEvents(h)).toHaveLength(2);
    // поздняя задача прежней ревизии — no-op
    expect(await h.worker.get(RouteRideCheckProcessor).check(first.rideId, 1)).toBe('skipped');
    expect(await h.worker.get(RouteRideCheckProcessor).check(first.rideId, 2)).toBe('passed');
  });
});

describe('AC6: отказы POST', () => {
  it('загрузка без разбора → 409 NOT_READY; негодный файл → 409 UPLOAD_FAILED; чужая активность и загрузка → 404', async () => {
    const r = await rider(h);
    const stranger = await rider(h, 'stranger@example.com');
    const routeId = await catalogCorridorRoute(h, OTHER);
    const pending = parsedUpload(await uploadTrack(h, r.auth, rideGpx('clean.gpx', dayAt(0))));
    expect((await post(r.auth, routeId, { uploadId: pending.id })).body).toMatchObject({
      code: 'ROUTE_RIDE_NOT_READY',
    });
    const bad = await uploadRide(h, r.auth, fixture('no-time.gpx'));
    expect(bad.outcome).toBe('failed');
    const failed = await post(r.auth, routeId, { uploadId: bad.uploadId });
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ code: 'ROUTE_RIDE_UPLOAD_FAILED' });

    const theirs = await uploadRide(h, stranger.auth, rideGpx('clean.gpx', dayAt(1)));
    for (const body of [
      { activityId: theirs.activityId },
      { uploadId: theirs.uploadId },
      { activityId: UNKNOWN },
    ]) {
      const res = await post(r.auth, routeId, body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await post(r.auth, routeId, { activityId: 'x' })).status).toBe(400);
    expect((await post(r.auth, routeId, { activityId: UNKNOWN, uploadId: UNKNOWN })).status).toBe(
      400,
    );
  });

  it('31-й POST за час → 429 RATE_LIMITED (повторы и 404 считаются)', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    for (let i = 0; i < 30; i += 1) {
      expect((await post(r.auth, routeId, { activityId: UNKNOWN })).status).toBe(404);
    }
    const limited = await post(r.auth, routeId, { activityId: UNKNOWN });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('100 живых заездов → 409 QUOTA_EXCEEDED; с осиротевшими — POST проходит, сироты удалены', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const upload = await uploadRide(h, r.auth, rideGpx('clean.gpx', dayAt(0)));
    const activityIds = Array.from({ length: 100 }, () => uuidv7());
    // живые активности — прямой вставкой (поля, которые читает liveActivities)
    await h.db
      .collection<{ _id: string }>('activities')
      .insertMany(activityIds.map((id) => ({ _id: id, userId: r.userId, duplicateOf: null })));
    const template = (activityId: string): RouteRideDoc => ({
      _id: uuidv7(),
      userId: r.userId,
      routeId,
      activityId,
      activity: {
        startedAt: dayAt(-1),
        endedAt: dayAt(-1, 30),
        source: 'upload',
        elapsedSec: 1800,
        distanceM: 8000,
      },
      corridorWidthM: 50,
      status: 'not_passed',
      checkRevision: 1,
      checkAttempts: 1,
      reasons: ['no_start'],
      failure: null,
      segment: null,
      touchedCorridor: false,
      engineVersion: 1,
      trackMap: null,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
      checkedAt: h.clock.now(),
    });
    await routeRidesDb(h).rides.insertMany(activityIds.map(template));
    const full = await post(r.auth, routeId, { activityId: upload.activityId });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ code: 'ROUTE_RIDE_QUOTA_EXCEEDED' });

    // половина активностей удалена — их заезды осиротели
    await h.db
      .collection<{ _id: string }>('activities')
      .deleteMany({ _id: { $in: activityIds.slice(0, 50) } });
    expect((await post(r.auth, routeId, { activityId: upload.activityId })).status).toBe(201);
    expect(await routeRidesDb(h).rides.countDocuments({ userId: r.userId, routeId })).toBe(51);
  });
});

describe('AC7: удалённая активность и недоступный маршрут — заезд не виден', () => {
  it('удаление загрузки → заезд пропал из списка, GET и track — 404', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const ride = await checked(r.auth, routeId, rideGpx('clean.gpx', dayAt(0)));
    await routeRidesWorker(h).drain();
    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${ride.uploadId}/delete`, {}, r.auth)).status,
    ).toBe(204);
    expect(await page(r.auth, routeId)).toMatchObject({
      summary: { count: 0, passedCount: 0, best: null },
      items: [],
    });
    expect((await get(r.auth, ridesUrl(routeId, `/${ride.rideId}`))).status).toBe(404);
    expect((await get(r.auth, ridesUrl(routeId, `/${ride.rideId}/track`))).status).toBe(404);
  });

  it('событие tracks.activity-removed → заезды активности удалены по всем маршрутам; чужие не тронуты; повтор — 0', async () => {
    const r = await rider(h);
    const other = await rider(h, 'other@example.com');
    const first = await catalogCorridorRoute(h, OTHER);
    const second = await catalogCorridorRoute(h, OTHER);
    const removed = await checked(r.auth, first, rideGpx('clean.gpx', dayAt(0)));
    expect((await post(r.auth, second, { activityId: removed.activityId })).status).toBe(201);
    const kept = await checked(r.auth, first, rideGpx('clean.gpx', dayAt(1)));
    const foreign = await checked(other.auth, first, rideGpx('clean.gpx', dayAt(0)));
    const worker = routeRidesWorker(h);
    await worker.drain();

    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${removed.uploadId}/delete`, {}, r.auth)).status,
    ).toBe(204);
    const [event] = (await outboxEvents(h)).filter(
      (e) => e.type === TRACK_ACTIVITY_REMOVED && !worker.handled.has(e._id),
    );
    expect(event).toBeDefined();
    // до события заезды на месте: удаляет подписка, а не транзакция удаления загрузки
    expect(await routeRidesDb(h).rides.countDocuments({ activityId: removed.activityId! })).toBe(2);
    expect(await worker.drain()).toBe(1);
    expect(await routeRidesDb(h).rides.countDocuments({ activityId: removed.activityId! })).toBe(0);
    const left = await routeRidesDb(h)
      .rides.find({}, { projection: { _id: 1 } })
      .toArray();
    expect(left.map((ride) => ride._id).sort()).toEqual([kept.rideId, foreign.rideId].sort());

    // повтор задачи (ретрай BullMQ) — без ошибки и без удалений
    const intake = h.worker.get(RouteRidesIntakeProcessor);
    expect(await intake.process(outboxJob(TRACK_ACTIVITY_REMOVED, event!._id))).toBe(0);
  });

  it('activity-removed без валидного payload — пропуск; неизвестная задача — ошибка', async () => {
    const intake = h.worker.get(RouteRidesIntakeProcessor);
    expect(await intake.process(outboxJob(TRACK_ACTIVITY_REMOVED, uuidv7()))).toBe('skipped');
    await expect(intake.process(outboxJob('tracks.activity-ready', uuidv7()))).rejects.toThrow(
      /unknown job/,
    );
  });

  it('свой маршрут удалён или маршрут каталога снят — 404; снова опубликован — заезды видны', async () => {
    const r = await rider(h);
    const own = await ownCorridorRoute(h, r.userId);
    const catalog = await catalogCorridorRoute(h, OTHER);
    const ownRide = await checked(r.auth, own, rideGpx('clean.gpx', dayAt(0)));
    const catalogRide = await checked(r.auth, catalog, rideGpx('clean.gpx', dayAt(1)));
    expect((await call(h, 'POST', `/v1/routes/mine/${own}/delete`, {}, r.auth)).status).toBe(204);
    expect((await get(r.auth, ridesUrl(own))).status).toBe(404);
    expect((await get(r.auth, ridesUrl(own, `/${ownRide.rideId}`))).status).toBe(404);
    expect((await get(r.auth, ridesUrl(own, `/${ownRide.rideId}/track`))).status).toBe(404);

    const published = await routesDb(h).routes.findOne({ _id: catalog });
    await routesDb(h).routes.updateOne({ _id: catalog }, { $set: { catalog: null } });
    expect((await get(r.auth, ridesUrl(catalog))).status).toBe(404);
    expect((await get(r.auth, ridesUrl(catalog, `/${catalogRide.rideId}`))).status).toBe(404);
    expect((await get(r.auth, ridesUrl(catalog, `/${catalogRide.rideId}/track`))).status).toBe(404);
    await routesDb(h).routes.updateOne({ _id: catalog }, { $set: { catalog: published!.catalog } });
    expect((await page(r.auth, catalog)).items.map((item) => item.id)).toEqual([
      catalogRide.rideId,
    ]);
  });
});

describe('AC9: ответы — явный список полей, no-store, AuthGuard, pipe Uuid', () => {
  it('ключи пяти ответов; Cache-Control: no-store; без токена — 401; candidates — не Uuid-pipe; не-UUID rideId — 400', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const ride = await checked(r.auth, routeId, rideGpx('clean.gpx', dayAt(0)));
    await routeRidesWorker(h).drain();
    const keys = (value: unknown) => Object.keys(value as object).sort();

    const created = await post(r.auth, routeId, { activityId: ride.activityId });
    const list = await get(r.auth, ridesUrl(routeId));
    const candidates = await get(r.auth, ridesUrl(routeId, '/candidates'));
    const one = await get(r.auth, ridesUrl(routeId, `/${ride.rideId}`));
    const track = await get(r.auth, ridesUrl(routeId, `/${ride.rideId}/track`));
    for (const res of [created, list, candidates, one, track]) {
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    const detailKeys = [
      'activity',
      'activityId',
      'checkedAt',
      'comparison',
      'createdAt',
      'elapsedSec',
      'failure',
      'id',
      'origin',
      'reason',
      'route',
      'routeDistanceM',
      'status',
    ];
    const activityKeys = ['distanceM', 'elapsedSec', 'source', 'startedAt'];
    for (const body of [created.body, one.body]) {
      expect(keys(body)).toEqual(detailKeys);
      const d = body as RouteRideDetail;
      expect(keys(d.activity)).toEqual(activityKeys);
      expect(keys(d.route)).toEqual(['distanceM', 'id', 'title']);
      expect(keys(d.comparison)).toEqual([
        'best',
        'deltaToBestSec',
        'deltaToPreviousSec',
        'isBest',
        'previous',
      ]);
      expect(keys(d.comparison.best)).toEqual(['elapsedSec', 'id', 'rideStartedAt']);
    }
    const p = list.body as RouteRidePage;
    expect(keys(p)).toEqual(['items', 'route', 'summary']);
    expect(keys(p.summary)).toEqual(['best', 'count', 'passedCount']);
    expect(keys(p.items[0])).toEqual([
      'activity',
      'createdAt',
      'elapsedSec',
      'id',
      'isBest',
      'reason',
      'status',
    ]);
    expect(keys(p.items[0]!.activity)).toEqual(activityKeys);
    const c = candidates.body as RouteRideCandidates;
    expect(keys(c)).toEqual(['items']);
    expect(keys(c.items[0])).toEqual([
      'activityId',
      'distanceM',
      'elapsedSec',
      'rideId',
      'source',
      'startedAt',
    ]);
    expect(keys(track.body)).toEqual(['line', 'marks', 'offRuns', 'rideId', 'segment']);
    const text = JSON.stringify([created.body, list.body, candidates.body, one.body]);
    expect(text).not.toMatch(/userId|sha256|trackMap|engineVersion|sensors|flags|\[\s*-?\d+\.\d+,/);
    expect(text).not.toContain(r.userId);
    // id активности — только у кандидатов и своя основная в детали (route-rides-03)
    expect(JSON.stringify(list.body)).not.toContain(ride.activityId!);
    for (const body of [created.body, one.body]) {
      const { activityId, ...rest } = body as RouteRideDetail;
      expect(activityId).toBe(ride.activityId);
      expect(JSON.stringify(rest)).not.toContain(ride.activityId!);
    }

    for (const url of [
      ridesUrl(routeId),
      ridesUrl(routeId, '/candidates'),
      ridesUrl(routeId, `/${ride.rideId}`),
      ridesUrl(routeId, `/${ride.rideId}/track`),
    ]) {
      expect((await get({}, url)).status).toBe(401);
    }
    expect((await post({}, routeId, { activityId: ride.activityId })).status).toBe(401);
    expect((await get(r.auth, ridesUrl(routeId, '/not-a-uuid'))).status).toBe(400);
    expect((await get(r.auth, ridesUrl('not-a-uuid'))).status).toBe(400);
  });
});

describe('кандидаты', () => {
  it('вне рамки, indoor и старше 365 дней — нет; у проверенного и его дубля — rideId; новые сверху', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    const old = await uploadRide(
      h,
      r.auth,
      rideGpx('clean.gpx', new Date(h.clock.now().getTime() - 366 * DAY)),
    );
    const far = await uploadRide(h, r.auth, rideGpx('far-away.gpx', dayAt(1)));
    const indoor = await uploadRide(
      h,
      r.auth,
      rideGpx('clean.gpx', dayAt(2), { type: 'indoor_cycling' }),
    );
    const plain = await uploadRide(h, r.auth, rideGpx('clean.gpx', dayAt(3)));
    const gpx = rideGpx('clean.gpx', dayAt(4));
    const ride = await checked(r.auth, routeId, gpx);
    for (const u of [old, far, indoor, plain]) expect(u.outcome).toBe('ready');

    const list = async () => {
      const res = await get(r.auth, ridesUrl(routeId, '/candidates'));
      expect(res.status).toBe(200);
      return RouteRideCandidates.parse(res.body).items;
    };
    expect((await list()).map((item) => [item.activityId, item.rideId])).toEqual([
      [ride.activityId, ride.rideId],
      [plain.activityId, null],
    ]);
    // импорт Garmin с мощностью становится основной группы — у неё тот же заезд
    const imported = await importRide(h, r.userId, gpx, { hasHeartRate: false, hasPower: true });
    const items = await list();
    expect(items[0]).toMatchObject({ activityId: imported.activityId, rideId: ride.rideId });
    expect(items).toHaveLength(2);
  });

  it('не больше 30', async () => {
    const r = await rider(h);
    const routeId = await catalogCorridorRoute(h, OTHER);
    // активности прямой вставкой (быстрее 31 разбора): линия трека — эталон коридора
    const base = await uploadRide(h, r.auth, rideGpx('clean.gpx', dayAt(0)));
    const activity = await tracks(h).activities.findOne({ _id: base.activityId! });
    const line = await tracks(h).tracks.findOne({ _id: base.activityId! });
    for (let i = 1; i <= 31; i += 1) {
      const id = uuidv7();
      await tracks(h).activities.insertOne({
        ...activity!,
        _id: id,
        startedAt: dayAt(-i),
        endedAt: dayAt(-i, 20),
      });
      await tracks(h).tracks.insertOne({ ...line!, _id: id });
    }
    expect(
      RouteRideCandidates.parse((await get(r.auth, ridesUrl(routeId, '/candidates'))).body).items,
    ).toHaveLength(30);
  });
});
