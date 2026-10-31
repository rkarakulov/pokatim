import { rm } from 'node:fs/promises';

import { RouteRideDetail, RouteRidePage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  autoEvents,
  catalogCorridorRoute,
  job,
  ownCorridorRoute,
  ridesUrl,
  routeRidesDb,
  routeRidesRepository,
  routeRidesWorker,
} from '../../../test/route-rides';
import {
  CORRIDOR,
  corridorRoute,
  importRide,
  rideGpx,
  rider,
  uploadRide,
} from '../../../test/results';
import { routesDb } from '../../../test/routes';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { tracks } from '../../../test/tracks';
import { QUEUE } from '../../queues';
import { resultsOutboxRoutes } from '../results';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { RouteRideAutoProcessor } from './route-ride-auto.processor';
import { RouteRideEvaluator } from './route-ride-evaluator';
import { routeRidesOutboxRoutes } from './route-rides.events';
import { newRideDoc, ROUTE_RIDE_POLICY } from './route-rides.policy';

/**
 * Автопроверка новой активности (route-rides-03, AC1–AC4): `RouteRideAutoProcessor.run`/`process` напрямую, сверка —
 * настоящий поток разбора; маршруты — линия эталона (`clean.gpx`), заезды — фикстуры коридора со сдвигом времени.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

/** Заезды — за 1–2 дня до часов стенда (22.10 09:00 UTC): в окне 7 суток. */
const RECENT = new Date('2026-10-20T06:00:00Z');
const at = (hours: number) => new Date(RECENT.getTime() + hours * 3_600_000);
const OTHER = '01890a5d-ac96-774b-bcce-b30209900002';

type Auth = Record<string, string>;
const auto = () => h.worker.get(RouteRideAutoProcessor);
const evaluator = () => h.worker.get(RouteRideEvaluator, { strict: false });
const source = () => h.worker.get<ActivitySource>(ACTIVITY_SOURCE);
const rides = () => routeRidesDb(h).rides;
const page = async (auth: Auth, routeId: string) =>
  RouteRidePage.parse((await call(h, 'GET', ridesUrl(routeId), undefined, auth)).body);

/** Загрузить заезд (готов, своя новая группа) — id активности. */
async function ride(auth: Auth, gpx: Buffer): Promise<string> {
  const upload = await uploadRide(h, auth, gpx);
  expect(upload.outcome).toBe('ready');
  return upload.activityId!;
}

/** Заезд по маршруту прямой вставкой (любой статус) — маршрут попадает в «уже ездил». */
async function seedRide(
  userId: string,
  routeId: string,
  activityId: string,
  status = 'not_passed',
  snapshotOf = activityId,
) {
  const activity = await source().activity(userId, snapshotOf);
  const doc = newRideDoc({
    userId,
    routeId,
    activity: { ...activity!, id: activityId },
    origin: 'manual',
    now: h.clock.now(),
  });
  await rides().insertOne({ ...doc, status: status as 'not_passed' });
  return doc._id;
}

/** Маршрут каталога с линией эталона, сдвинутой на `dLon` градусов (далёкая рамка). */
async function shiftedCatalogRoute(dLon: number): Promise<string> {
  const id = await corridorRoute(h, OTHER, {
    ...CORRIDOR,
    line: CORRIDOR.line.map(([lon, lat]) => [lon + dLon, lat] as [number, number]),
  });
  await routesDb(h).routes.updateOne(
    { _id: id },
    { $set: { catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() } } },
  );
  return id;
}

describe('AC1: новая активность → passed по маршрутам «уже ездил» и своим готовым', () => {
  it('passed с origin auto и сравнением; маршрут без заездов вне плана; не пройден — ничего; лимит POST не тратится', async () => {
    const r = await rider(h);
    const ridden = await catalogCorridorRoute(h, OTHER);
    const own = await ownCorridorRoute(h, r.userId);
    const untouched = await catalogCorridorRoute(h, OTHER);
    // прошлый заезд по маршруту каталога: пройден (сравнение)
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    const previousId = await seedRide(r.userId, ridden, earlier, 'not_passed');
    const counted = await evaluator().evaluate((await rides().findOne({ _id: previousId }))!);
    await rides().updateOne({ _id: previousId }, { $set: { ...counted } });
    expect(counted.status).toBe('passed');

    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0), { scale: 1.1 }));
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 2, passed: 2 });

    const created = await rides().find({ activityId: fresh }).toArray();
    expect(created.map((doc) => doc.routeId).sort()).toEqual([own, ridden].sort());
    for (const doc of created) {
      expect(doc).toMatchObject({
        origin: 'auto',
        status: 'passed',
        checkRevision: 1,
        checkAttempts: 1,
        corridorWidthM: ROUTE_RIDE_POLICY.corridorWidthM,
      });
      expect(doc.segment).not.toBeNull();
      expect(doc.updatedAt).toEqual(h.clock.now());
    }
    const autoRide = created.find((doc) => doc.routeId === ridden)!;
    const res = await call(h, 'GET', ridesUrl(ridden, `/${autoRide._id}`), undefined, r.auth);
    expect(res.status).toBe(200);
    const detail = RouteRideDetail.parse(res.body);
    expect(detail).toMatchObject({ activityId: fresh, origin: 'auto', status: 'passed' });
    expect(detail.comparison.previous?.id).toBe(previousId);
    expect(detail.comparison.best?.id).toBe(previousId);
    expect(await rides().countDocuments({ routeId: untouched })).toBe(0);

    // не пройден (сход до финиша) — заезда нет
    const stopped = await ride(r.auth, rideGpx('stop-80pct.gpx', at(12)));
    expect(await auto().run(stopped, r.userId)).toEqual({ planned: 2, passed: 0 });
    expect(await rides().countDocuments({ activityId: stopped })).toBe(0);
    // лимит ручных проверок не списан
    expect(await h.redis.keys('*route-rides-user*')).toEqual([]);
    expect((await page(r.auth, own)).items.map((item) => item.status)).toEqual(['passed']);
  });

  it('событие outbox → задача route-ride-auto (process); повтор того же события — без второго заезда', async () => {
    const r = await rider(h);
    const own = await ownCorridorRoute(h, r.userId);
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));
    const [event] = (await autoEvents(h)).filter(
      (item) => (item.payload as { activityId: string }).activityId === fresh,
    );
    expect(event).toBeDefined();
    expect(await auto().process(job(event!.type, event!._id))).toEqual({ planned: 1, passed: 1 });
    expect(await auto().process(job(event!.type, event!._id, 1))).toEqual({
      planned: 0,
      passed: 0,
    });
    expect(await rides().countDocuments({ routeId: own })).toBe(1);
    await expect(auto().process(job('route-rides.check-requested', event!._id))).rejects.toThrow(
      'unknown job',
    );

    // тестовый воркер: автопроверка — только с { auto: true }
    expect(await routeRidesWorker(h).drain()).toBe(0);
    expect(await routeRidesWorker(h, { auto: true }).drain()).toBe(1);
    expect(await rides().countDocuments({ routeId: own })).toBe(1);
  });
});

describe('AC2: что не триггерит', () => {
  it('станок, бег, старт старше 7 суток до приёма, удалённая активность — skipped; дубль — без события', async () => {
    const r = await rider(h);
    const own = await ownCorridorRoute(h, r.userId);
    const evaluate = vi.spyOn(evaluator(), 'evaluate');
    const indoor = await ride(r.auth, rideGpx('clean.gpx', at(0), { type: 'virtual_ride' }));
    const run = await ride(r.auth, rideGpx('clean.gpx', at(3), { type: 'running' }));
    const old = await ride(r.auth, rideGpx('clean.gpx', new Date('2026-10-14T06:00:00Z')));
    for (const id of [indoor, run, old]) {
      expect(await auto().run(id, r.userId), id).toBe('skipped');
    }
    const deleted = await uploadRide(h, r.auth, rideGpx('clean.gpx', at(6)));
    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${deleted.uploadId}/delete`, {}, r.auth)).status,
    ).toBe(204);
    expect(await auto().run(deleted.activityId!, r.userId)).toBe('skipped');
    // чужая активность — как удалённая
    const stranger = await rider(h, 'stranger@example.com');
    const theirs = await ride(stranger.auth, rideGpx('clean.gpx', at(9)));
    expect(await auto().run(theirs, r.userId)).toBe('skipped');
    expect(evaluate).not.toHaveBeenCalled();

    // дубль (тот же заезд импортом с мощностью перехватил основную) — нового события нет
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(12)));
    const before = (await autoEvents(h)).length;
    const dup = await importRide(h, r.userId, rideGpx('clean.gpx', at(12)), {
      hasHeartRate: false,
      hasPower: true,
    });
    expect(dup.outcome).toBe('ready');
    expect(await autoEvents(h)).toHaveLength(before);
    // событие новой группы — по Wahoo; обработка — основная группы сейчас (Garmin), один заезд
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 1, passed: 1 });
    expect(await rides().findOne({ routeId: own })).toMatchObject({ activityId: dup.activityId });
  });

  it('чужой маршрут райдера, снятый с публикации, далёкая рамка, заезд группы, квота 100 — вне плана', async () => {
    const r = await rider(h);
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    const theirs = await ownCorridorRoute(h, OTHER);
    const unpublished = await catalogCorridorRoute(h, OTHER);
    const far = await shiftedCatalogRoute(0.2);
    const full = await catalogCorridorRoute(h, OTHER);
    const almost = await catalogCorridorRoute(h, OTHER);
    for (const routeId of [theirs, unpublished, far, almost]) {
      await seedRide(r.userId, routeId, earlier);
    }
    await routesDb(h).routes.updateOne({ _id: unpublished }, { $set: { catalog: null } });
    // квота: 100 живых заездов (активности — фикстуры вставкой), рядом — 99
    const fillers = Array.from({ length: ROUTE_RIDE_POLICY.maxPerRoute }, () => uuidv7());
    const proto = await tracks(h).activities.findOne({ _id: earlier });
    await tracks(h).activities.insertMany(
      fillers.map((id, i) => ({
        ...proto!,
        _id: id,
        uploadId: uuidv7(),
        startedAt: new Date(proto!.startedAt.getTime() - (i + 1) * 86_400_000),
      })),
    );
    for (const id of fillers) await seedRide(r.userId, full, id, 'not_passed', earlier);
    for (const id of fillers.slice(1, ROUTE_RIDE_POLICY.maxPerRoute - 1)) {
      await seedRide(r.userId, almost, id, 'not_passed', earlier);
    }
    expect(await rides().countDocuments({ routeId: almost })).toBe(99);

    const evaluate = vi.spyOn(evaluator(), 'evaluate');
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 1, passed: 1 });
    expect(evaluate.mock.calls.map(([doc]) => doc.routeId)).toEqual([almost]);

    // заезд группы уже есть — повтор без прогона движка
    evaluate.mockClear();
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 0, passed: 0 });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('больше 20 подходящих маршрутов — проверяются первые 20 по порядку V2 (уже ездил, затем свои новые → старые)', async () => {
    const r = await rider(h);
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    const older = await ride(r.auth, rideGpx('clean.gpx', at(-48)));
    const riddenLate = await catalogCorridorRoute(h, OTHER);
    const riddenEarly = await catalogCorridorRoute(h, OTHER);
    await seedRide(r.userId, riddenEarly, older);
    await seedRide(r.userId, riddenLate, earlier);
    const own: string[] = [];
    for (let i = 0; i < 20; i += 1) own.push(await ownCorridorRoute(h, r.userId));
    // свой маршрут, по которому уже ездил, — в (а), не дважды
    await seedRide(r.userId, own[0]!, older);

    const evaluate = vi.spyOn(evaluator(), 'evaluate').mockImplementation(async () => ({
      status: 'not_passed',
      reasons: ['no_finish'],
      failure: null,
      segment: null,
      touchedCorridor: true,
      engineVersion: 1,
      trackMap: null,
      checkedAt: h.clock.now(),
    }));
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 20, passed: 0 });
    const newestFirst = own.slice(1).reverse();
    expect(evaluate.mock.calls.map(([doc]) => doc.routeId)).toEqual([
      riddenLate,
      // одна дата заезда у own[0] и riddenEarly — порядок по id маршрута
      ...[riddenEarly, own[0]!].sort(),
      ...newestFirst.slice(0, 17),
    ]);
    expect(await rides().countDocuments({ activityId: fresh })).toBe(0);
  });
});

describe('AC3: гонки и сбои', () => {
  it('ручной POST во время автопроверки — один заезд; POST после автозаезда — 200, тот же заезд', async () => {
    const r = await rider(h);
    const routeA = await ownCorridorRoute(h, r.userId);
    const routeB = await catalogCorridorRoute(h, OTHER);
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    await seedRide(r.userId, routeB, earlier);
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));

    // ворота: ручной POST по маршруту B коммитится между сверкой и вставкой автопроверки
    const repository = routeRidesRepository(h);
    const insert = repository.insertChecked.bind(repository);
    let manualId: string | undefined;
    vi.spyOn(repository, 'insertChecked').mockImplementation(async (doc) => {
      if (doc.routeId === routeB && !manualId) {
        const res = await call(h, 'POST', ridesUrl(routeB), { activityId: fresh }, r.auth);
        expect(res.status).toBe(201);
        manualId = RouteRideDetail.parse(res.body).id;
      }
      return insert(doc);
    });
    // план: B (уже ездил), затем A (свой)
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 2, passed: 1 });
    expect(await rides().find({ routeId: routeB, activityId: fresh }).toArray()).toMatchObject([
      { _id: manualId, origin: 'manual' },
    ]);
    const autoRide = await rides().findOne({ routeId: routeA, activityId: fresh });
    expect(autoRide).toMatchObject({ origin: 'auto', status: 'passed' });

    const again = await call(h, 'POST', ridesUrl(routeA), { activityId: fresh }, r.auth);
    expect(again.status).toBe(200);
    expect(RouteRideDetail.parse(again.body)).toMatchObject({
      id: autoRide!._id,
      origin: 'auto',
      status: 'passed',
    });
  });

  it('вставка проиграла уникальный индекс — пропуск без ошибки', async () => {
    const r = await rider(h);
    const routeA = await ownCorridorRoute(h, r.userId);
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));
    const repository = routeRidesRepository(h);
    const insert = repository.insertChecked.bind(repository);
    vi.spyOn(repository, 'insertChecked').mockImplementation(async (doc) => {
      await rides().insertOne({ ...doc, _id: uuidv7(), origin: 'manual' });
      return insert(doc);
    });
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 1, passed: 0 });
    expect(await rides().countDocuments({ routeId: routeA })).toBe(1);
  });

  it('сбой окружения: не финальная попытка — исключение; финальная — маршрут пропущен, следующий проверен', async () => {
    const r = await rider(h);
    const routeA = await catalogCorridorRoute(h, OTHER);
    const routeB = await ownCorridorRoute(h, r.userId);
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    await seedRide(r.userId, routeA, earlier);
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));

    vi.spyOn(evaluator(), 'analyze').mockRejectedValueOnce(new Error('loader crashed'));
    await expect(auto().run(fresh, r.userId)).rejects.toThrow('loader crashed');
    expect(await rides().countDocuments({ activityId: fresh })).toBe(0);

    vi.spyOn(evaluator(), 'analyze').mockRejectedValueOnce(new Error('loader crashed'));
    expect(await auto().run(fresh, r.userId, { finalAttempt: true })).toEqual({
      planned: 2,
      passed: 1,
    });
    expect(await rides().find({ activityId: fresh }).toArray()).toMatchObject([
      { routeId: routeB, origin: 'auto' },
    ]);
  });

  it('маршрут скрыт между планом и прогоном, активность удалена во время прогона — заезда нет', async () => {
    const r = await rider(h);
    const routeA = await catalogCorridorRoute(h, OTHER);
    const earlier = await ride(r.auth, rideGpx('clean.gpx', at(-24)));
    await seedRide(r.userId, routeA, earlier);
    const fresh = await ride(r.auth, rideGpx('clean.gpx', at(0)));
    const evaluate = evaluator().evaluate.bind(evaluator());
    vi.spyOn(evaluator(), 'evaluate').mockImplementationOnce(async (doc) => {
      await routesDb(h).routes.updateOne({ _id: routeA }, { $set: { catalog: null } });
      return evaluate(doc);
    });
    expect(await auto().run(fresh, r.userId)).toEqual({ planned: 1, passed: 0 });
    expect(await rides().countDocuments({ activityId: fresh })).toBe(0);

    // AC-12: активность удалена (стирание аккаунта) между сверкой и вставкой
    const own = await ownCorridorRoute(h, r.userId);
    const second = await uploadRide(h, r.auth, rideGpx('clean.gpx', at(12)));
    vi.spyOn(evaluator(), 'evaluate').mockImplementationOnce(async (doc) => {
      const result = await evaluate(doc);
      await call(h, 'POST', `/v1/tracks/uploads/${second.uploadId}/delete`, {}, r.auth);
      return result;
    });
    expect(await auto().run(second.activityId!, r.userId)).toEqual({ planned: 1, passed: 0 });
    expect(await rides().countDocuments({ routeId: own })).toBe(0);
  });
});

describe('AC4: гонки получают tracks.activity-ready как прежде', () => {
  it('маршруты публикатора: activity-ready → results-intake, activity-group-created → route-ride-auto, типы не пересекаются', () => {
    expect(resultsOutboxRoutes['tracks.activity-ready']).toBe(QUEUE.resultsIntake);
    expect(routeRidesOutboxRoutes['tracks.activity-group-created']).toBe(QUEUE.routeRideAuto);
    const shared = Object.keys(resultsOutboxRoutes).filter(
      (type) => type in routeRidesOutboxRoutes,
    );
    expect(shared).toEqual([]);
  });
});
