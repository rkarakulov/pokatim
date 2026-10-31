import { rm } from 'node:fs/promises';

import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CITY_CENTERS, MyRaceEntry, RaceResultsPage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Connected,
  connect,
  connectActive,
  createDevicesHarness,
  devices,
  jobOf,
  rider as deviceRider,
  rideTrack,
  syncService,
} from '../../../test/devices';
import { type FakeOw, startFakeOw } from '../../../test/fake-ow';
import { twoToneImage } from '../../../test/avatars';
import { DAY, HOUR, type Harness } from '../../../test/harness';
import {
  bearer,
  call,
  collections,
  erasedEmail,
  outboxEvents,
  validRegistration,
} from '../../../test/identity';
import { panel } from '../../../test/panel';
import { profileReportsDb, reportRider } from '../../../test/profiles';
import {
  corridorRace,
  enterRace,
  protocolAction,
  protocolRace,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider as raceRider,
  signIn,
  travelTo,
  uploadRide,
} from '../../../test/results';
import {
  eventsOfType,
  expoToken,
  notificationsDb,
  seedNotification,
} from '../../../test/notifications';
import {
  createRide,
  hideInDb,
  join,
  ridesDb,
  seedApprovedRoute,
  startsIn,
} from '../../../test/rides';
import {
  MY_ROUTES,
  publicationDoc,
  reportRoute,
  riderCall,
  routeReportsDb,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { achievementsDb } from '../../../test/achievements';
import { routeRidesDb } from '../../../test/route-rides';
import { staff } from '../../../test/races';
import {
  calendarStart,
  enableCalendarTickets,
  registerFor,
  ticketsDb,
} from '../../../test/tickets';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { storeUpload, trackFileStore, tracks } from '../../../test/tracks';
import { QUEUE } from '../../queues';
import { AchievementErasure } from '../achievements';
import { DeviceErasure } from '../devices';
import { ProfileErasure } from '../profile';
import { RideErasure } from '../rides';
import { RouteRideErasure } from '../route-rides';
import { RouteErasure } from '../routes';
import { TicketErasure } from '../tickets';
import { TrackErasure } from '../tracks';
import { AccountErasure } from '../identity';
import { AccountErasureProcessor } from './account-erasure.processor';
import {
  ACCOUNT_DELETION_REQUESTED,
  ACCOUNT_DELETION_SWEEP_JOB,
  ACCOUNT_ERASURE_RESUME_JOB,
} from './account.events';

/**
 * Фоновая очистка удалённого аккаунта (AC2–AC5, N4, N5, N8, N9): два райдера с одинаковым набором данных — A удаляет
 * аккаунт, данные B (и маршрут платформы) не меняются. Процессор очереди вызывается напрямую задачами, как их отдал
 * бы worker; OW — фейковый.
 */
let ow: FakeOw;
let h: Harness;
beforeAll(async () => {
  ow = await startFakeOw();
  h = await createDevicesHarness(ow);
});
beforeEach(async () => {
  await h.reset();
  ow.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await ow.stop();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const { password: PASSWORD } = validRegistration();
const processor = () => h.worker.get(AccountErasureProcessor);
const accountQueue = (): Queue =>
  h.worker.get(getQueueToken(QUEUE.accountDeletion), { strict: false });

/** Удаление аккаунта по HTTP (как приложение). */
async function deleteAccount(accessToken: string): Promise<void> {
  const res = await call(
    h,
    'POST',
    '/v1/account/delete',
    { password: PASSWORD },
    bearer(accessToken),
  );
  if (res.status !== 204) throw new Error(`delete: ${res.status} ${JSON.stringify(res.body)}`);
}

/** Первый проход по событию outbox пользователя (`attemptsMade` — номер попытки). */
async function firstPass(userId: string, attemptsMade = 0): Promise<unknown> {
  const event = (await outboxEvents(h)).find(
    (e) =>
      e.type === ACCOUNT_DELETION_REQUESTED && (e.payload as { userId: string }).userId === userId,
  );
  if (!event) throw new Error('no deletion event');
  return processor().process(
    jobOf(ACCOUNT_DELETION_REQUESTED, { outboxEventId: event._id }, attemptsMade) as Job,
  );
}

const sweep = (userId: string, attemptsMade = 0) =>
  processor().process(jobOf(ACCOUNT_DELETION_SWEEP_JOB, { userId }, attemptsMade) as Job);

interface World {
  a: Connected;
  b: Connected;
  rides: { aFuture: string; aPast: string; aHidden: string; bFuture: string; bPast: string };
  routes: { a: string; aPlatform: string; b: string };
  uploads: { a: string[]; b: string[] };
}

/** Профиль с именем и согласием (журнал согласий пишется). */
async function namedProfile(accessToken: string, name: string) {
  const auth = bearer(accessToken);
  await call(h, 'PUT', '/v1/profile/onboarding/survey', { reasons: ['races'] }, auth);
  const res = await call(
    h,
    'PATCH',
    '/v1/profile',
    { publicName: name, showNameInResults: true },
    auth,
  );
  if (res.status !== 200) throw new Error(`profile: ${res.status}`);
}

/** Тренировка Garmin с треком в OW и pull — загрузка провайдера, импорт и маркер источника. */
async function providerRide(who: Connected, hoursAgo: number) {
  const start = new Date(h.clock.now().getTime() - hoursAgo * HOUR);
  const points = rideTrack(start);
  ow.addWorkout(who.aggUserId, {
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + points.length * 1000).toISOString(),
    duration_seconds: points.length,
  });
  ow.addTrack(who.aggUserId, 'garmin', points);
  await syncService(h).pull(who.connectionId);
}

async function manualRide(accessToken: string, at: Date) {
  return uploadRide(h, bearer(accessToken), rideGpx('clean.gpx', at));
}

/** Одинаковый набор данных у A и B. */
async function world(): Promise<World> {
  const a = await connectActive(h, ow, await deviceRider(h, 'a@example.com'));
  const b = await connectActive(h, ow, await deviceRider(h, 'b@example.com'));
  for (const [who, name] of [
    [a, 'Анна'],
    [b, 'Борис'],
  ] as const) {
    await namedProfile(who.accessToken, name);
    // второе подключение — ожидает подтверждения (тикет)
    expect((await connect(h, who, 'wahoo')).status).toBe(200);
  }

  const ra = { token: a.accessToken, userId: a.userId };
  const rb = { token: b.accessToken, userId: b.userId };
  const aFuture = (await createRide(h, ra, { organizerName: 'Анна' })).id;
  const aPast = (await createRide(h, ra, { organizerName: 'Анна', startsAt: startsIn(h, 2 * DAY) }))
    .id;
  const aHidden = (
    await createRide(h, ra, { organizerName: 'Анна', startsAt: startsIn(h, 3 * DAY) })
  ).id;
  const bFuture = (await createRide(h, rb, { organizerName: 'Борис' })).id;
  const bPast = (
    await createRide(h, rb, { organizerName: 'Борис', startsAt: startsIn(h, 2 * DAY) })
  ).id;
  expect((await join(h, rb, aFuture)).status).toBe(200);
  expect((await join(h, ra, bFuture)).status).toBe(200);
  expect((await join(h, ra, bPast)).status).toBe(200);
  await call(h, 'POST', `/v1/rides/${bFuture}/reports`, { reason: 'spam' }, bearer(a.accessToken));
  await hideInDb(h, aHidden);
  // прошедшие: старт в прошлом (подготовка данных — прямой записью)
  const past = new Date(h.clock.now().getTime() - DAY);
  await ridesDb(h).updateMany({ _id: { $in: [aPast, bPast] } }, { $set: { startsAt: past } });

  const routes = {
    a: await seedRiderRoute(h, a.userId),
    aPlatform: await seedRiderRoute(h, a.userId),
    b: await seedRiderRoute(h, b.userId),
  };
  // маршрут платформы, загруженный A как сотрудником, — не «мой маршрут»
  await routesDb(h).routes.updateOne({ _id: routes.aPlatform }, { $set: { origin: 'platform' } });

  const uploads: World['uploads'] = { a: [], b: [] };
  for (const [who, list] of [
    [a, uploads.a],
    [b, uploads.b],
  ] as const) {
    const manual = await manualRide(who.accessToken, new Date(h.clock.now().getTime() - 5 * HOUR));
    list.push(manual.uploadId);
    await providerRide(who, 3);
  }
  for (const who of [a, b]) {
    const provider = await tracks(h).uploads.findOne({ userId: who.userId, source: 'garmin' });
    if (!provider) throw new Error('нет загрузки провайдера');
    (who === a ? uploads.a : uploads.b).push(provider._id);
  }
  return { a, b, rides: { aFuture, aPast, aHidden, bFuture, bPast }, routes, uploads };
}

/** Все данные пользователя по коллекциям (для «не задеты» и «тот же итог»). */
async function snapshotOf(userId: string) {
  const byUser = { userId };
  const [
    profiles,
    rides,
    routes,
    uploads,
    activities,
    connections,
    accounts,
    imports,
    tickets,
    sourceRefs,
  ] = await Promise.all([
    h.db
      .collection('profiles')
      .find({ _id: userId as never })
      .toArray(),
    ridesDb(h)
      .find({ $or: [{ organizerUserId: userId }, { 'participants.userId': userId }] })
      .sort({ _id: 1 })
      .toArray(),
    routesDb(h).routes.find({ ownerUserId: userId }).sort({ _id: 1 }).toArray(),
    tracks(h).uploads.find(byUser).sort({ _id: 1 }).toArray(),
    tracks(h).activities.find(byUser).sort({ _id: 1 }).toArray(),
    devices(h).connections.find(byUser).sort({ _id: 1 }).toArray(),
    devices(h).accounts.find({ _id: userId }).toArray(),
    devices(h).imports.find(byUser).sort({ _id: 1 }).toArray(),
    devices(h).tickets.find(byUser).toArray(),
    tracks(h).sourceRefs.find(byUser).toArray(),
  ]);
  return {
    profiles,
    rides,
    routes,
    uploads,
    activities,
    connections,
    accounts,
    imports,
    tickets,
    sourceRefs,
  };
}

/** Журналы append-only пользователя (A9): количество записей. */
async function journalsOf(userId: string) {
  return {
    consents: await collections(h).userConsents.countDocuments({ userId }),
    profileConsents: await h.db.collection('profile_consent_events').countDocuments({ userId }),
    deviceAudit: await h.db.collection('device_audit').countDocuments({ userId }),
    rideReports: await h.db.collection('ride_reports').countDocuments({ reporterUserId: userId }),
  };
}

describe('первый проход очистки (AC2, AC5, A9, N4)', () => {
  it('данные A удалены по каждой коллекции, B и маршрут платформы — без изменений; журналы на месте; одно письмо', async () => {
    const w = await world();
    const bBefore = await snapshotOf(w.b.userId);
    const aJournals = await journalsOf(w.a.userId);
    const aKeys = (await tracks(h).uploads.find({ userId: w.a.userId }).toArray()).map(
      (u) => u.storageKey,
    );
    const platformBefore = await routesDb(h).routes.findOne({ _id: w.routes.aPlatform });
    const deleteCalls = () => ow.calls.filter((c) => c.method === 'DELETE').length;

    await deleteAccount(w.a.accessToken);
    h.mailer.reset();
    expect(await firstPass(w.a.userId)).toBe('erased');

    const a = w.a.userId;
    // профиль
    expect(await h.db.collection('profiles').countDocuments({ _id: a as never })).toBe(0);
    // райды (A6)
    const ride = (id: string) => ridesDb(h).findOne({ _id: id });
    expect(await ride(w.rides.aFuture)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'organizer_unavailable',
      organizerName: null,
    });
    expect(await ride(w.rides.aPast)).toMatchObject({ status: 'published', organizerName: null });
    expect(await ride(w.rides.aHidden)).toMatchObject({
      status: 'hidden',
      hiddenFromStatus: 'cancelled',
      cancelReason: 'organizer_unavailable',
      organizerName: null,
    });
    const bFuture = await ride(w.rides.bFuture);
    expect(bFuture?.participants.map((p) => p.userId)).toEqual([w.b.userId]);
    expect(bFuture?.goingCount).toBe(1);
    expect(bFuture?.organizerName).toBe('Борис');
    // прошедший чужой райд с отметкой A — отметка осталась
    expect((await ride(w.rides.bPast))?.participants.map((p) => p.userId)).toContain(a);
    // маршруты (A7): свои — каскадом, платформы — цел
    expect(await routesDb(h).routes.countDocuments({ ownerUserId: a, origin: 'rider' })).toBe(0);
    expect(await routesDb(h).geometries.countDocuments({ _id: w.routes.a })).toBe(0);
    expect(await routesDb(h).sources.countDocuments({ _id: w.routes.a })).toBe(0);
    expect(await routesDb(h).routes.findOne({ _id: w.routes.aPlatform })).toEqual(platformBefore);
    // заезды и файлы (A7)
    expect(await tracks(h).uploads.countDocuments({ userId: a })).toBe(0);
    expect(await tracks(h).activities.countDocuments({ userId: a })).toBe(0);
    expect(await tracks(h).sourceRefs.countDocuments({ userId: a })).toBe(0);
    expect(await tracks(h).meta.countDocuments({ _id: a })).toBe(0);
    for (const key of aKeys) {
      if (key) await expect(trackFileStore(h).get(key)).rejects.toThrow();
    }
    // устройства (A8): отзыв в OW, данные удалены, журнал дописан
    expect(deleteCalls()).toBeGreaterThanOrEqual(1);
    expect(
      ow.calls.some(
        (c) =>
          c.method === 'DELETE' && c.path.includes(w.a.aggUserId) && c.path.endsWith('/garmin'),
      ),
    ).toBe(true);
    expect(ow.calls.some((c) => c.method === 'DELETE' && c.path.includes(w.b.aggUserId))).toBe(
      false,
    );
    for (const collection of ['connections', 'imports', 'tickets'] as const) {
      expect(await devices(h)[collection].countDocuments({ userId: a })).toBe(0);
    }
    expect(await devices(h).accounts.countDocuments({ _id: a })).toBe(0);
    const audit = await h.db
      .collection('device_audit')
      .find({ userId: a, reason: 'account_deleted' })
      .toArray();
    expect(audit.map((row) => row['action']).sort()).toEqual(['disconnected', 'disconnected']);
    // identity: письмо и стирание (AC5, A4)
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]).toMatchObject({ to: 'a@example.com', subject: 'Аккаунт удалён' });
    expect(await collections(h).users.findOne({ _id: a })).toMatchObject({
      email: erasedEmail(h, 'a@example.com'),
      birthDate: null,
      passwordHash: null,
    });
    // журналы append-only (A9): ничего не удалено; device_audit — только дописан
    const after = await journalsOf(a);
    expect({ ...after, deviceAudit: aJournals.deviceAudit }).toEqual(aJournals);
    expect(after.deviceAudit).toBe(aJournals.deviceAudit + 2);
    expect(await panel(h).audit.countDocuments({ action: 'account.deleted' })).toBe(1);
    // B не задет (N4); отметка B в райде A осталась, райд отменён
    expect(await snapshotOf(w.b.userId)).toEqual({
      ...bBefore,
      rides: (await snapshotOf(w.b.userId)).rides,
    });
    const bRides = await ridesDb(h)
      .find({ organizerUserId: w.b.userId })
      .sort({ _id: 1 })
      .toArray();
    expect(bRides.map((r) => [r._id, r.status, r.organizerName])).toEqual(
      bBefore.rides
        .filter((r) => r.organizerUserId === w.b.userId)
        .map((r) => [r._id, r.status, r.organizerName]),
    );
    expect((await ride(w.rides.aFuture))?.participants.map((p) => p.userId)).toContain(w.b.userId);
  });

  it('routes-06 (AC7, U6): опубликованный и поданный маршруты A с жалобами — удалены вместе с жалобами; жалоба A на маршрут B — осталась', async () => {
    const w = await world();
    const a = w.a.userId;
    const aApproved = await seedApprovedRiderRoute(h, a);
    const aPending = await seedRiderRoute(h, a, { publication: publicationDoc(h, 'pending') });
    const bApproved = await seedApprovedRiderRoute(h, w.b.userId);
    expect((await reportRoute(h, w.b.accessToken, aApproved)).status).toBe(200);
    expect((await reportRoute(h, w.a.accessToken, bApproved)).status).toBe(200);
    expect((await call(h, 'GET', `/v1/routes/${aApproved}`)).status).toBe(200);

    await deleteAccount(w.a.accessToken);
    expect(await firstPass(a)).toBe('erased');

    for (const id of [aApproved, aPending]) {
      expect(await routesDb(h).routes.countDocuments({ _id: id })).toBe(0);
      expect(await routeReportsDb(h).countDocuments({ routeId: id })).toBe(0);
    }
    expect((await call(h, 'GET', `/v1/routes/${aApproved}`)).status).toBe(404);
    // жалоба удалённого жалобщика на чужой маршрут хранится (как ride_reports, PR #62)
    expect(await routeReportsDb(h).find({ reporterUserId: a }).toArray()).toEqual([
      expect.objectContaining({ routeId: bApproved, resolvedAt: null }),
    ]);
    expect((await routesDb(h).routes.findOne({ _id: bApproved }))?.publication).toMatchObject({
      status: 'approved',
      openReportCount: 1,
    });
  });

  it('повтор задачи — тот же итог, без ошибок и без второго письма (N5)', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    h.mailer.reset();
    expect(await firstPass(w.a.userId)).toBe('erased');
    const once = await snapshotOf(w.a.userId);
    const rides = await ridesDb(h).find().sort({ _id: 1 }).toArray();
    // отмена будущего опубликованного — событие на райд (ADR-0017); скрытый — без события (RC-8)
    const cancelled = async () =>
      (await eventsOfType(h, 'rides.ride-cancelled')).map((event) => event.payload);
    expect(await cancelled()).toEqual([{ rideId: w.rides.aFuture }]);

    expect(await firstPass(w.a.userId)).toBe('erased');
    expect(await sweep(w.a.userId)).toBe('erased');

    expect(await snapshotOf(w.a.userId)).toEqual(once);
    expect(await ridesDb(h).find().sort({ _id: 1 }).toArray()).toEqual(rides);
    expect(await cancelled()).toEqual([{ rideId: w.rides.aFuture }]);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('сбой на каждом шаге 1–6 по очереди — ретрай завершает очистку, письмо одно (N5)', async () => {
    const w = await world();
    const bBefore = await snapshotOf(w.b.userId);
    await deleteAccount(w.a.accessToken);
    h.mailer.reset();
    const failOnce = [
      vi.spyOn(h.worker.get(ProfileErasure), 'erase'),
      vi.spyOn(h.worker.get(RideErasure), 'erase'),
      vi.spyOn(h.worker.get(RouteErasure), 'erase'),
      vi.spyOn(h.worker.get(DeviceErasure), 'erase'),
      vi.spyOn(h.worker.get(TrackErasure), 'erase'),
      vi.spyOn(h.worker.get(AccountErasure), 'notifyAndErase'),
    ];

    for (const [index, spy] of failOnce.entries()) {
      spy.mockRejectedValueOnce(new Error(`step ${index + 1} failed`));
      await expect(firstPass(w.a.userId, index)).rejects.toThrow(`step ${index + 1} failed`);
    }
    expect(await firstPass(w.a.userId, 4)).toBe('erased');

    expect(await snapshotOf(w.a.userId)).toMatchObject({
      profiles: [],
      routes: [expect.objectContaining({ origin: 'platform' })],
      uploads: [],
      activities: [],
      connections: [],
      accounts: [],
      imports: [],
      tickets: [],
      sourceRefs: [],
    });
    expect(h.mailer.sent).toHaveLength(1);
    expect((await snapshotOf(w.b.userId)).uploads).toEqual(bBefore.uploads);
  });

  it('финальная попытка с провалом шага — лог account.erasure_failed с шагом, без e-mail', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(h.worker.get(RouteErasure), 'erase').mockRejectedValueOnce(new Error('boom'));

    await expect(firstPass(w.a.userId, 4)).rejects.toThrow('boom');

    expect(errors.mock.calls.map((args) => String(args[0]))).toContain(
      `account.erasure_failed user=${w.a.userId} step=routes`,
    );
  });

  it('логи шагов — uid, шаг и счётчики; без e-mail и имён', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    await firstPass(w.a.userId);
    const lines = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' ')));

    for (const step of [
      'profile',
      'rides',
      'routes',
      'ride-starts',
      'devices',
      'tracks',
      'route-rides',
      'achievements',
      'tickets',
      'notifications',
      'identity',
    ]) {
      expect(lines.some((line) => line.includes(`user=${w.a.userId} step=${step}`))).toBe(true);
    }
    for (const line of lines) {
      expect(line).not.toMatch(/@example\.com|Анна|Кофе-райд|Мой маршрут/);
    }
  });
});

describe('точки райдов на удалённых раньше маршрутах (05c, RC-1, фиксы ревью pass 1)', () => {
  it('автор удалил публичный маршрут, потом аккаунт — точка чужого райда сброшена на центр города; повтор — no-op', async () => {
    const author = await deviceRider(h, 'a@example.com');
    const org = await deviceRider(h, 'b@example.com');
    const routeId = await seedApprovedRoute(h, author.userId, [27.62, 53.96]);
    const ride = await createRide(
      h,
      { token: org.accessToken, userId: org.userId },
      { routeId, cityCode: 'borisov' },
    );
    const removed = await riderCall(
      h,
      author.accessToken,
      'POST',
      `${MY_ROUTES}/${routeId}/delete`,
      {},
    );
    expect(removed.status).toBe(204);
    expect(await ridesDb(h).findOne({ _id: ride.id })).toMatchObject({ startPrecise: true });

    await deleteAccount(author.accessToken);
    expect(await firstPass(author.userId)).toBe('erased');
    const after = await ridesDb(h).findOne({ _id: ride.id });
    expect(after).toMatchObject({
      routeId,
      geo: { type: 'Point', coordinates: [...CITY_CENTERS.borisov] },
      startPrecise: false,
      version: 0,
    });
    expect(await sweep(author.userId)).toBe('erased');
    expect(await ridesDb(h).findOne({ _id: ride.id })).toEqual(after);
  });
});

describe('шаг notifications (N11, ADR-0017)', () => {
  /** Уведомление, настройки, токен устройства и тикет Expo пользователя. */
  async function notificationData(userId: string, suffix: string) {
    const db = notificationsDb(h);
    await seedNotification(h, userId);
    const now = h.clock.now();
    await db.settings.insertOne({
      _id: userId,
      push: { races: false, disputes: true, rides: true },
      email: { disputes: true, rides: true },
      quietHours: { enabled: false, startHour: 22, endHour: 8 },
      updatedAt: now,
    });
    const tokenId = `0190a8c8-0000-7000-8000-0000000000${suffix}`;
    await db.pushTokens.insertOne({
      _id: tokenId,
      token: expoToken(suffix),
      userId,
      platform: 'ios',
      createdAt: now,
      updatedAt: now,
    });
    await db.pushTickets.insertOne({
      _id: `0190a8c8-0000-7000-8000-0000000001${suffix}`,
      ticketId: `ticket-${suffix}`,
      tokenId,
      userId,
      createdAt: now,
      expireAt: new Date(now.getTime() + DAY),
    });
  }
  const countsOf = async (userId: string) => {
    const db = notificationsDb(h);
    return {
      notifications: await db.notifications.countDocuments({ userId }),
      settings: await db.settings.countDocuments({ _id: userId }),
      tokens: await db.pushTokens.countDocuments({ userId }),
    };
  };

  it('уведомления, настройки, токены и тикеты A стёрты (токен, записанный после удаления, тоже), B — нет; повтор — без ошибок', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    // гонка «PUT push-tokens ↔ транзакция удаления»: токен и данные записаны уже после закрытия аккаунта
    await notificationData(w.a.userId, '01');
    await notificationData(w.b.userId, '02');

    expect(await firstPass(w.a.userId)).toBe('erased');

    expect(await countsOf(w.a.userId)).toEqual({ notifications: 0, settings: 0, tokens: 0 });
    expect(await notificationsDb(h).pushTickets.countDocuments({ ticketId: 'ticket-01' })).toBe(0);
    expect(await countsOf(w.b.userId)).toEqual({ notifications: 1, settings: 1, tokens: 1 });
    expect(await notificationsDb(h).pushTickets.countDocuments({ ticketId: 'ticket-02' })).toBe(1);

    expect(await sweep(w.a.userId)).toBe('erased');
    expect(await countsOf(w.b.userId)).toEqual({ notifications: 1, settings: 1, tokens: 1 });
  });
});

describe('шаг route-rides (route-rides-01)', () => {
  /** Заезд по маршруту прямой вставкой (порт стирания читает только userId). */
  async function seedRouteRide(userId: string) {
    const now = h.clock.now();
    await routeRidesDb(h).rides.insertOne({
      _id: uuidv7(),
      userId,
      routeId: uuidv7(),
      activityId: uuidv7(),
      activity: { startedAt: now, endedAt: now, source: 'upload', elapsedSec: 60, distanceM: 100 },
      corridorWidthM: 50,
      status: 'queued',
      checkRevision: 1,
      checkAttempts: 0,
      reasons: [],
      failure: null,
      segment: null,
      touchedCorridor: null,
      engineVersion: null,
      trackMap: null,
      createdAt: now,
      updatedAt: now,
      checkedAt: null,
    });
  }

  it('заезды удалённого стёрты (после tracks), чужие целы; повтор — 0', async () => {
    const w = await world();
    await seedRouteRide(w.a.userId);
    await seedRouteRide(w.a.userId);
    await seedRouteRide(w.b.userId);
    await deleteAccount(w.a.accessToken);
    expect(await firstPass(w.a.userId)).toBe('erased');

    expect(await routeRidesDb(h).rides.countDocuments({ userId: w.a.userId })).toBe(0);
    expect(await routeRidesDb(h).rides.countDocuments({ userId: w.b.userId })).toBe(1);
    expect(await h.worker.get(RouteRideErasure).erase(w.a.userId)).toBe(0);
  });
});

describe('шаг tickets (event-tickets, RC-T1)', () => {
  it('регистрации и билеты удалённого → cancelled, место освобождено; документы остаются; чужие целы; повтор — нули', async () => {
    const w = await world();
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await calendarStart(h, admin.token);
    await enableCalendarTickets(h, admin.token, id, { capacity: 10 });
    for (const who of [w.a, w.b]) {
      expect((await registerFor(h, bearer(who.accessToken), id)).status).toBe(201);
    }
    expect((await ticketsDb(h).ticketing.findOne({}))?.registeredCount).toBe(2);
    await deleteAccount(w.a.accessToken);
    expect(await firstPass(w.a.userId)).toBe('erased');

    expect(await ticketsDb(h).registrations.findOne({ userId: w.a.userId })).toMatchObject({
      status: 'cancelled',
    });
    expect(await ticketsDb(h).tickets.findOne({ userId: w.a.userId })).toMatchObject({
      status: 'cancelled',
    });
    expect(await ticketsDb(h).tickets.findOne({ userId: w.b.userId })).toMatchObject({
      status: 'active',
    });
    expect((await ticketsDb(h).ticketing.findOne({}))?.registeredCount).toBe(1);
    expect(await h.worker.get(TicketErasure).erase(w.a.userId)).toEqual({
      registrations: 0,
      tickets: 0,
    });
  });
});

describe('шаг achievements (achievements, AC7)', () => {
  it('выдачи (обе коллекции) и маркер сверки удалённого стёрты, чужие целы; повтор — нули', async () => {
    const w = await world();
    // маркер первой сверки (и выдачи по фактам мира) — через API, недостижимые в мире коды — прямой вставкой
    for (const who of [w.a, w.b]) {
      expect(
        (await call(h, 'GET', '/v1/achievements', undefined, bearer(who.accessToken))).status,
      ).toBe(200);
    }
    const now = h.clock.now();
    const grant = (userId: string, code: 'rides_10' | 'routes_5') => ({
      _id: uuidv7(),
      userId,
      code,
      object: { kind: 'race' as const, id: uuidv7() },
      factAt: now,
      grantedAt: now,
      seenAt: null,
      revokedAt: null,
      updatedAt: now,
    });
    await achievementsDb(h).grants.insertMany([
      grant(w.a.userId, 'rides_10'),
      grant(w.a.userId, 'routes_5'),
      grant(w.b.userId, 'rides_10'),
    ]);
    const seasonGrant = (userId: string) => ({
      _id: uuidv7(),
      userId,
      code: 'season_podium' as const,
      seasonId: uuidv7(),
      factAt: now,
      grantedAt: now,
      seenAt: null,
      revokedAt: null,
      updatedAt: now,
    });
    await achievementsDb(h).seasonGrants.insertMany([
      seasonGrant(w.a.userId),
      seasonGrant(w.a.userId),
      seasonGrant(w.b.userId),
    ]);
    const bGrants = await achievementsDb(h).grants.find({ userId: w.b.userId }).toArray();
    const bSeasonGrants = await achievementsDb(h)
      .seasonGrants.find({ userId: w.b.userId })
      .toArray();
    await deleteAccount(w.a.accessToken);
    expect(await firstPass(w.a.userId)).toBe('erased');

    expect(await achievementsDb(h).grants.countDocuments({ userId: w.a.userId })).toBe(0);
    expect(await achievementsDb(h).syncs.countDocuments({ _id: w.a.userId })).toBe(0);
    expect(await achievementsDb(h).seasonGrants.countDocuments({ userId: w.a.userId })).toBe(0);
    expect(await achievementsDb(h).grants.find({ userId: w.b.userId }).toArray()).toEqual(bGrants);
    expect(await achievementsDb(h).seasonGrants.find({ userId: w.b.userId }).toArray()).toEqual(
      bSeasonGrants,
    );
    expect(await achievementsDb(h).syncs.countDocuments({ _id: w.b.userId })).toBe(1);
    expect(await h.worker.get(AchievementErasure).erase(w.a.userId)).toEqual({
      grants: 0,
      seasonGrants: 0,
      syncs: 0,
    });
  });
});

describe('аватары профиля (rider-profile, AC10)', () => {
  /** Аватар по HTTP (как приложение); ответ — id аватара. */
  async function uploadAvatar(accessToken: string): Promise<string> {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/v1/profile/avatar',
      headers: { 'content-type': 'application/octet-stream', ...bearer(accessToken) },
      payload: await twoToneImage('png'),
    });
    if (res.statusCode !== 200) throw new Error(`avatar: ${res.statusCode} ${res.body}`);
    return (JSON.parse(res.body) as { avatar: { id: string } }).avatar.id;
  }
  const avatarStatus = async (id: string) =>
    (await h.app.inject({ method: 'GET', url: `/v1/avatars/${id}` })).statusCode;
  const avatars = () => h.db.collection('profile_avatars');

  it('стирание удаляет аватары пользователя и профиль; чужие целы; старый id → 404; повтор безопасен', async () => {
    const a = await deviceRider(h, 'a@example.com');
    const b = await deviceRider(h, 'b@example.com');
    await namedProfile(a.accessToken, 'Анна');
    const aAvatar = await uploadAvatar(a.accessToken);
    const bAvatar = await uploadAvatar(b.accessToken);
    // поздний «осиротевший» документ того же пользователя тоже стирается (deleteMany по userId)
    await avatars().insertOne({ _id: 'orphan' as never, userId: a.userId, createdAt: new Date() });
    const publicId = (
      (await call(h, 'GET', '/v1/profile', undefined, bearer(a.accessToken))).body as {
        publicId: string;
      }
    ).publicId;
    expect((await call(h, 'GET', `/v1/riders/${publicId}`)).status).toBe(200);

    await deleteAccount(a.accessToken);
    expect(await firstPass(a.userId)).toBe('erased');

    expect(await avatars().countDocuments({ userId: a.userId })).toBe(0);
    expect(await avatarStatus(aAvatar)).toBe(404);
    expect(await avatarStatus(bAvatar)).toBe(200);
    expect(await avatars().countDocuments({ userId: b.userId })).toBe(1);
    expect((await call(h, 'GET', `/v1/riders/${publicId}`)).status).toBe(404);

    expect(await sweep(a.userId)).toBe('erased');
    expect(await avatars().countDocuments({ userId: b.userId })).toBe(1);
  });
});

describe('жалобы на профиль (profile-moderation, AC9)', () => {
  const publicIdOf = async (accessToken: string) =>
    (
      (await call(h, 'GET', '/v1/profile', undefined, bearer(accessToken))).body as {
        publicId: string;
      }
    ).publicId;

  it('стирание удаляет жалобы на удалённого; его жалобы на других остаются; повтор безопасен', async () => {
    const a = await deviceRider(h, 'a@example.com');
    const b = await deviceRider(h, 'b@example.com');
    const c = await deviceRider(h, 'c@example.com');
    await namedProfile(a.accessToken, 'Анна');
    await namedProfile(b.accessToken, 'Борис');
    const aPublic = await publicIdOf(a.accessToken);
    const bPublic = await publicIdOf(b.accessToken);
    expect((await reportRider(h, b.accessToken, aPublic, { reason: 'name' })).status).toBe(200);
    expect((await reportRider(h, c.accessToken, aPublic, { reason: 'photo' })).status).toBe(200);
    expect((await reportRider(h, a.accessToken, bPublic, { reason: 'club' })).status).toBe(200);
    expect((await reportRider(h, c.accessToken, bPublic, { reason: 'spam' })).status).toBe(200);

    await deleteAccount(a.accessToken);
    expect(await firstPass(a.userId)).toBe('erased');

    expect(await profileReportsDb(h).countDocuments({ targetUserId: a.userId })).toBe(0);
    expect(
      await profileReportsDb(h)
        .find({ targetUserId: b.userId })
        .project({ _id: 0, reporterUserId: 1, resolvedAt: 1 })
        .sort({ _id: 1 })
        .toArray(),
    ).toEqual([
      { reporterUserId: a.userId, resolvedAt: null },
      { reporterUserId: c.userId, resolvedAt: null },
    ]);

    expect(await sweep(a.userId)).toBe('erased');
    expect(await profileReportsDb(h).countDocuments({ targetUserId: b.userId })).toBe(2);
    expect(await profileReportsDb(h).countDocuments({ targetUserId: a.userId })).toBe(0);
  });
});

describe('охрана и повторный проход (N8, N9, resume)', () => {
  it('задача для неудалённого аккаунта — skipped, ничего не тронуто (N8)', async () => {
    const w = await world();
    const before = await snapshotOf(w.a.userId);
    const user = await collections(h).users.findOne({ _id: w.a.userId });
    h.mailer.reset();

    expect(await sweep(w.a.userId)).toBe('skipped');

    expect(await snapshotOf(w.a.userId)).toEqual(before);
    expect(await collections(h).users.findOne({ _id: w.a.userId })).toEqual(user);
    expect(h.mailer.sent).toHaveLength(0);
    expect(ow.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('первый проход ставит повторный с задержкой (одна задача на пользователя)', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    await firstPass(w.a.userId);
    await firstPass(w.a.userId);

    const jobs = (await accountQueue().getJobs(['delayed', 'waiting'])).filter(
      (job) => job.name === ACCOUNT_DELETION_SWEEP_JOB,
    );
    expect(jobs.map((job) => job.data)).toEqual([{ userId: w.a.userId }]);
    expect(jobs[0]?.opts.delay).toBe(15 * 60_000);
  });

  it('поздние записи после первого прохода убирает повторный проход; отметка erasureSweptAt (N9)', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    await firstPass(w.a.userId);
    // запросы, прошедшие AuthGuard до удаления, коммитят после очистки (R5)
    await h.db.collection('profiles').insertOne({ _id: w.a.userId as never, publicName: 'Поздно' });
    await seedRiderRoute(h, w.a.userId);
    await storeUpload(
      h,
      w.a.userId,
      rideGpx('clean.gpx', new Date(h.clock.now().getTime() - 2 * HOUR)),
    );

    expect(await sweep(w.a.userId)).toBe('erased');

    expect(await h.db.collection('profiles').countDocuments({ _id: w.a.userId as never })).toBe(0);
    expect(
      await routesDb(h).routes.countDocuments({ ownerUserId: w.a.userId, origin: 'rider' }),
    ).toBe(0);
    expect(await tracks(h).uploads.countDocuments({ userId: w.a.userId })).toBe(0);
    expect((await collections(h).users.findOne({ _id: w.a.userId }))?.erasureSweptAt).toEqual(
      h.clock.now(),
    );
  });

  it('регламент resume ставит повторный проход только удалённым раньше часа без erasureSweptAt', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    await accountQueue().obliterate({ force: true });
    h.clock.advance(HOUR + 1);
    await deleteAccount((await signInFresh('b@example.com')).accessToken);

    expect(await processor().process(jobOf(ACCOUNT_ERASURE_RESUME_JOB, {}) as Job)).toBe(1);

    const jobs = (await accountQueue().getJobs(['waiting', 'delayed'])).filter(
      (job) => job.name === ACCOUNT_DELETION_SWEEP_JOB,
    );
    expect(jobs.map((job) => job.data)).toEqual([{ userId: w.a.userId }]);
  });
});

/** Новый access по паролю (часы стенда ушли вперёд). */
async function signInFresh(email: string) {
  const res = await call(h, 'POST', '/v1/auth/session/sign-in', { email, password: PASSWORD });
  const body = res.body as { state: string; session: { accessToken: string } };
  if (body.state !== 'signedIn') throw new Error(`вход: ${res.status}`);
  return body.session;
}

describe('устройства при очистке', () => {
  it('агрегатор недоступен не на финале — бросок (ретрай); на финале — revokeFailed и журнал, данные удалены', async () => {
    const w = await world();
    await deleteAccount(w.a.accessToken);
    ow.fail('DELETE /users/{id}/connections/garmin', 503, 10);

    await expect(firstPass(w.a.userId)).rejects.toThrow();
    expect(await devices(h).connections.countDocuments({ userId: w.a.userId })).toBeGreaterThan(0);

    expect(await firstPass(w.a.userId, 4)).toBe('erased');
    const failed = await h.db
      .collection('device_audit')
      .find({ userId: w.a.userId, action: 'revoke_failed' })
      .toArray();
    expect(failed.map((row) => row['reason'])).toContain('account_deleted');
    expect(await devices(h).connections.countDocuments({ userId: w.a.userId })).toBe(0);
  });

  it('отзыв: not_found в OW — успех; позднее tracks.upload-deleted не создаёт device_imports', async () => {
    const w = await world();
    const workout = await devices(h).imports.findOne({ userId: w.a.userId });
    ow.fail('DELETE /users/{id}/connections/garmin', 404, 1);
    await deleteAccount(w.a.accessToken);

    expect(await firstPass(w.a.userId)).toBe('erased');
    expect(
      await h.db
        .collection('device_audit')
        .countDocuments({ userId: w.a.userId, action: 'revoke_failed' }),
    ).toBe(0);
    expect(await syncService(h).onUploadDeleted('garmin', workout!.aggWorkoutId)).toBe('skipped');
    expect(await devices(h).imports.countDocuments({ userId: w.a.userId })).toBe(0);
  });
});

describe('гонки и протоколы (AC3, AC4)', () => {
  const RIDE = new Date('2026-10-25T06:00:00Z');

  it('попытка в открытом окне снята, предварительная таблица пересчитана; заявка осталась (AC4)', async () => {
    const race = await corridorRace(h);
    const a = await raceRider(h, 'a@example.com');
    const b = await raceRider(h, 'b@example.com');
    for (const r of [a, b]) expect((await enterRace(h, r.auth, race.raceId)).status).toBe(201);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, new Date('2026-10-25T08:00:00Z'));
    const aAuth = await signIn(h, a.email);
    await uploadRide(h, aAuth, rideGpx('clean.gpx', RIDE));
    await uploadRide(
      h,
      await signIn(h, b.email),
      rideGpx('clean.gpx', new Date(RIDE.getTime() + HOUR)),
    );
    await worker.drain();
    const table = async () =>
      RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${race.raceId}/results`)).body);
    expect((await table()).items).toHaveLength(2);
    const aEntry = MyRaceEntry.parse(
      (await call(h, 'GET', `/v1/races/${race.raceId}/entry`, undefined, aAuth)).body,
    ).entry!;

    await deleteAccount(aAuth.authorization!.slice('Bearer '.length));
    expect(await firstPass(a.userId)).toBe('erased');
    await worker.drain();

    const rows = (await table()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryId).not.toBe(aEntry.id);
    expect(rows[0]?.place).toBe(1);
    expect(await resultsDb(h).entries.countDocuments({ _id: aEntry.id })).toBe(1);
  });

  it('опубликованный протокол не меняется, строка удалённого — «Участник» (AC3)', async () => {
    const race = await protocolRace(h, [3600, 3700]);
    const [first] = race.riders;
    const auth = await signIn(h, first!.email);
    await call(h, 'PATCH', '/v1/profile', { publicName: 'Анна К.', showNameInResults: true }, auth);
    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
    const rows = await resultsDb(h)
      .protocolRows.find({ raceId: race.raceId })
      .sort({ order: 1 })
      .toArray();
    const named = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${race.raceId}/results`)).body,
    );
    expect(named.items[0]?.riderName).toBe('Анна К.');

    await deleteAccount(auth.authorization!.slice('Bearer '.length));
    expect(await firstPass(first!.userId)).toBe('erased');

    expect(
      await resultsDb(h).protocolRows.find({ raceId: race.raceId }).sort({ order: 1 }).toArray(),
    ).toEqual(rows);
    const after = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${race.raceId}/results`)).body,
    );
    expect(after.items.map((row) => [row.entryId, row.place, row.riderName])).toEqual([
      [first!.entryId, 1, null],
      [race.riders[1]!.entryId, 2, null],
    ]);
  });
});
