import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { type Job, type Queue, Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENTS,
  achievementsDb,
  daysAgo,
  pastRide,
  raceAt,
  seedRouteRide,
} from '../../../test/achievements';
import { type FakeExpo, startFakeExpo } from '../../../test/fake-expo';
import { createHarness, type Harness, HOUR, MINUTE } from '../../../test/harness';
import { collections } from '../../../test/identity';
import {
  eventsOfType,
  notificationsOf,
  runIntake,
  runPush,
  seedPushToken,
  uuidv7At,
} from '../../../test/notifications';
import { resultsDb } from '../../../test/results';
import { routeRidesDb } from '../../../test/route-rides';
import { authed, rider, ridesDb, type Rider } from '../../../test/rides';
import { racesDb } from '../../../test/races';
import { placedRow, seedProtocolRace, seedSeason, syncStandings } from '../../../test/standings';
import { QUEUE } from '../../queues';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import {
  ACHIEVEMENTS_RIDER_JOB,
  ACHIEVEMENTS_SWEEP_JOB,
  AchievementsSweep,
  achievementsRiderJobId,
} from './achievements-sweep';
import { AchievementsSyncProcessor } from './achievements-sync.processor';
import {
  ACHIEVEMENTS_SWEEP_LOCK_KEY,
  AchievementsSyncState,
  achievementsCursorKey,
} from './achievements-sync.state';
import { ACHIEVEMENTS_GRANT_NOTICED, AchievementsGrantNoticed } from './achievements.events';
import { ACHIEVEMENTS_SERVER_SYNC } from './achievements.policy';

/**
 * Серверная сверка достижений (achievements-push N2): регламент `achievements.sweep` ставит задачи `achievements.rider`
 * только райдерам изменившихся фактов с маркером первой сверки и живым аккаунтом (AC5, без полного скана), курсоры
 * Redis; AC3 — протокол опубликован → прогон → задача райдера из очереди → событие `origin: 'server'` → уведомление →
 * push в фейковом Expo, без открытия приложения.
 */
let expo: FakeExpo;
let h: Harness;
beforeAll(async () => {
  expo = await startFakeExpo();
  h = await createHarness({ PUSH_ENABLED: 'true', EXPO_PUSH_API_URL: expo.url });
});
beforeEach(async () => {
  await h.reset();
  expo.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await expo.stop();
});

const queue = (): Queue => h.worker.get(getQueueToken(QUEUE.achievementsSync), { strict: false });
const sweep = () => h.worker.get(AchievementsSweep, { strict: false });
const state = () => h.worker.get(AchievementsSyncState, { strict: false });
const ago = (ms: number) => new Date(h.clock.now().getTime() - ms);

/** Ждущие задачи очереди: имя, jobId, данные, попытки. */
async function waiting() {
  const jobs = await queue().getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs
    .map((job) => ({ name: job.name, id: job.id, data: job.data as unknown }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Выполнить ждущие задачи очереди как worker: взять, обработать процессором, перевести в `completed`. */
async function completeQueued(): Promise<unknown[]> {
  const q = queue();
  const worker = new Worker(q.name, null, { connection: q.opts.connection });
  const outcomes: unknown[] = [];
  try {
    const next = () => worker.getNextJob('lock-token', { block: false });
    for (let job: Job | undefined = await next(); job; job = await next()) {
      const outcome = await h.worker.get(AchievementsSyncProcessor).process(job);
      outcomes.push(outcome);
      await job.moveToCompleted(outcome, 'lock-token', false);
    }
  } finally {
    await worker.close();
  }
  return outcomes;
}

const markSynced = (who: Rider) =>
  achievementsDb(h).syncs.insertOne({ _id: who.userId, firstSyncAt: daysAgo(h, 30) });

/** Заезд по маршруту, итог `passed` которого записан в момент `at`. */
async function passedAt(who: Rider, at: Date) {
  const activityId = await seedRouteRide(h, who.userId, uuidv7(), daysAgo(h, 1));
  await routeRidesDb(h).rides.updateOne({ activityId }, { $set: { checkedAt: at, updatedAt: at } });
}

/** Ревизии гонки «на момент» `at` (uuidv7 базы берёт `Date.now()`, а не часы стенда). */
async function restampRevisions(raceId: string, at: Date) {
  const docs = await resultsDb(h).recalculations.find({ raceId }).toArray();
  await resultsDb(h).recalculations.deleteMany({ raceId });
  await resultsDb(h).recalculations.insertMany(
    docs.map((doc) => ({ ...doc, _id: uuidv7At(at), at })),
  );
}

const riderJob = (who: Rider) => ({
  name: ACHIEVEMENTS_RIDER_JOB,
  id: achievementsRiderJobId(who.userId, h.clock.now()),
  data: { userId: who.userId },
});

describe('AC5: выборка райдеров — только изменившиеся факты, маркер, живой аккаунт', () => {
  it('ставится только райдер с маркером, живым аккаунтом и фактом в окне; первый запуск — окно с until − 10 мин', async () => {
    const synced = await rider(h, 'synced@example.by');
    const unsynced = await rider(h, 'unsynced@example.by');
    const closed = await rider(h, 'closed@example.by');
    const stale = await rider(h, 'stale@example.by');
    const fresh = await rider(h, 'fresh@example.by');
    const idle = await rider(h, 'idle@example.by');
    for (const who of [synced, closed, stale, fresh, idle]) await markSynced(who);
    await collections(h).users.updateOne(
      { _id: closed.userId },
      { $set: { deletedAt: h.clock.now() } },
    );
    // until = now − 2 мин, курсора нет → окно (now − 12 мин, now − 2 мин]
    await passedAt(synced, ago(5 * MINUTE));
    await passedAt(unsynced, ago(5 * MINUTE));
    await passedAt(closed, ago(5 * MINUTE));
    await passedAt(stale, ago(20 * MINUTE));
    await passedAt(fresh, ago(MINUTE));

    const run = await sweep().run();
    expect(run).toMatchObject({ busy: false, enqueued: 1, failedSources: [] });
    expect(run.read.route_rides).toBe(3);
    expect(await waiting()).toEqual([riderJob(synced)]);
    // курсор — на последней прочитанной строке, повтор без новых фактов ничего не ставит
    expect(await state().cursor('route_rides')).toMatchObject({ at: ago(5 * MINUTE) });
    expect((await sweep().run()).enqueued).toBe(0);
    // строка «моложе settleMs» становится видна, когда окно до неё дошло
    h.clock.advance(2 * MINUTE);
    expect(await sweep().run()).toMatchObject({ enqueued: 1 });
    expect((await waiting()).map((job) => job.data)).toContainEqual({ userId: fresh.userId });
  });

  it('райды: участник — только через rideSettleMs (3 ч) после старта', async () => {
    const organizer = await rider(h, 'org@example.by');
    const goer = await rider(h, 'goer@example.by');
    await markSynced(organizer);
    await markSynced(goer);
    const done = await pastRide(h, organizer, [goer], 1);
    const riding = await pastRide(h, organizer, [], 1);
    await ridesDb(h).updateOne(
      { _id: done },
      { $set: { startsAt: ago(ACHIEVEMENTS_SERVER_SYNC.rideSettleMs + 5 * MINUTE) } },
    );
    await ridesDb(h).updateOne({ _id: riding }, { $set: { startsAt: ago(HOUR) } });
    const solo = await rider(h, 'solo@example.by');
    await markSynced(solo);
    await ridesDb(h).updateOne(
      { _id: riding },
      { $push: { participants: { userId: solo.userId, joinedAt: h.clock.now() } } as never },
    );

    const run = await sweep().run();
    expect(run.read.rides).toBe(2);
    expect((await waiting()).map((job) => job.data)).toEqual(
      expect.arrayContaining([{ userId: organizer.userId }, { userId: goer.userId }]),
    );
    expect(await waiting()).toHaveLength(2);
  });

  it('сбой источника: его курсор стоит, остальные двигаются, задачи поставлены, прогон падает с логом', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const me = await rider(h, 'me@example.by');
    await markSynced(me);
    await passedAt(me, ago(5 * MINUTE));
    const season = await seedSeason(h);
    const raceId = await raceAt(h, season, [placedRow(me.userId, 5)], daysAgo(h, 3));
    await restampRevisions(raceId, ago(4 * MINUTE));
    vi.spyOn(
      h.worker.get<RiderRouteRides>(RIDER_ROUTE_RIDES, { strict: false }),
      'passedRidersAfter',
    ).mockRejectedValueOnce(new Error('mongo down'));

    await expect(sweep().run()).rejects.toThrow('achievements.sweep failed: route_rides');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^achievements\.sweep_source_failed source=route_rides /),
    );
    expect(await waiting()).toEqual([riderJob(me)]);
    expect(await h.redis.get(achievementsCursorKey('route_rides'))).toBeNull();
    expect(await state().cursor('revisions')).toMatchObject({ at: ago(4 * MINUTE) });
    // следующий прогон дочитывает упавший источник
    h.clock.advance(MINUTE);
    expect(await sweep().run()).toMatchObject({ enqueued: 1, read: { route_rides: 1 } });
  });

  it('идёт другой прогон (замок) — ничего не читает и не ставит', async () => {
    const me = await rider(h, 'me@example.by');
    await markSynced(me);
    await passedAt(me, ago(5 * MINUTE));
    await h.redis.set(ACHIEVEMENTS_SWEEP_LOCK_KEY, 'other');
    expect(await sweep().run()).toMatchObject({ busy: true, enqueued: 0 });
    expect(await waiting()).toEqual([]);
    expect(await h.redis.get(ACHIEVEMENTS_SWEEP_LOCK_KEY)).toBe('other');
    await h.redis.del(ACHIEVEMENTS_SWEEP_LOCK_KEY);
    expect(await sweep().run()).toMatchObject({ busy: false, enqueued: 1 });
    expect(await h.redis.get(ACHIEVEMENTS_SWEEP_LOCK_KEY)).toBeNull();
  });

  it('аренда замка: продление своим токеном; истекла и досталась другому — ни продления, ни записи курсоров', async () => {
    const lock = ACHIEVEMENTS_SWEEP_LOCK_KEY;
    const token = (await state().lock())!;
    await h.redis.pexpire(lock, 1_000);
    expect(await state().extend(token)).toBe(true);
    expect(await h.redis.pttl(lock)).toBeGreaterThan(ACHIEVEMENTS_SERVER_SYNC.lockTtlMs - 10_000);

    await h.redis.set(lock, 'other');
    const cursor = { at: ago(MINUTE), id: 'x' };
    expect(await state().extend(token)).toBe(false);
    expect(await state().setCursors(token, new Map([['route_rides', cursor]]))).toBe(false);
    expect(await h.redis.get(achievementsCursorKey('route_rides'))).toBeNull();
    expect(await h.redis.get(lock)).toBe('other');
    expect(await state().setCursors('other', new Map([['route_rides', cursor]]))).toBe(true);
    expect(await state().cursor('route_rides')).toEqual(cursor);
  });

  it('аренда истекла посреди прогона, второй прогон захватил замок — первый не ставит задачи и не откатывает курсоры', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const me = await rider(h, 'me@example.by');
    await markSynced(me);
    await passedAt(me, ago(5 * MINUTE));
    const source = h.worker.get<RiderRouteRides>(RIDER_ROUTE_RIDES, { strict: false });
    vi.spyOn(source, 'passedRidersAfter').mockImplementationOnce(async () => {
      // замок первого истёк: второй прогон проходит целиком и сдвигает курсор, замок держит третий
      await h.redis.del(ACHIEVEMENTS_SWEEP_LOCK_KEY);
      expect(await sweep().run()).toMatchObject({ busy: false, enqueued: 1 });
      await h.redis.set(ACHIEVEMENTS_SWEEP_LOCK_KEY, 'third');
      return { userIds: [me.userId], next: { at: ago(9 * MINUTE), id: 'stale' } };
    });

    await expect(sweep().run()).rejects.toThrow('achievements.sweep lease lost');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^achievements\.sweep_lease_lost/));
    expect(await state().cursor('route_rides')).toMatchObject({ at: ago(5 * MINUTE) });
    expect(await waiting()).toEqual([riderJob(me)]);
    expect(await h.redis.get(ACHIEVEMENTS_SWEEP_LOCK_KEY)).toBe('third');
  });
});

describe('AC3: протокол опубликован → worker сверяет участника без открытия приложения → push', () => {
  it('регламент и задача райдера через очередь → событие origin server → уведомление → push; райдер без маркера — без задачи', async () => {
    const me = await rider(h, 'me@example.by');
    const newcomer = await rider(h, 'newcomer@example.by');
    await seedPushToken(h, me.userId, 'me');
    const season = await seedSeason(h);
    await raceAt(h, season, [placedRow(me.userId, 5)], daysAgo(h, 10));
    expect((await authed(h, me, 'GET', ACHIEVEMENTS)).status).toBe(200);
    const raceId = await raceAt(
      h,
      season,
      [placedRow(me.userId, 2), placedRow(newcomer.userId, 3)],
      daysAgo(h, 1),
      'Минское кольцо',
    );
    await restampRevisions(raceId, ago(5 * MINUTE));

    await queue().add(ACHIEVEMENTS_SWEEP_JOB, {}, { jobId: 'sweep-test' });
    // прогон ставит задачу райдера в ту же очередь — её берёт следующий шаг того же «worker»
    const [run, ...riders] = await completeQueued();
    expect(run).toMatchObject({ enqueued: 1, read: { revisions: 2 } });
    expect(riders).toEqual(['reconciled']);
    expect(await waiting()).toEqual([]);

    const events = await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED);
    expect(events.map((event) => AchievementsGrantNoticed.parse(event.payload))).toEqual([
      expect.objectContaining({ grant: 'fact', origin: 'server' }),
    ]);
    expect(await runIntake(h, ACHIEVEMENTS_GRANT_NOTICED, events[0]!._id)).toBe('written');
    const [notice] = await notificationsOf(h, me.userId);
    expect(notice).toMatchObject({
      kind: 'achievement_granted',
      group: 'achievements',
      target: { type: 'achievement', code: 'race_podium' },
      push: { state: 'pending' },
    });
    await runPush(h, me.userId);
    expect(expo.delivered).toHaveLength(1);
    expect(expo.delivered[0]!.message.title).toMatch(/Подиум/);
    expect(await notificationsOf(h, newcomer.userId)).toEqual([]);
    expect(await achievementsDb(h).grants.countDocuments({ userId: newcomer.userId })).toBe(0);
  });
});

describe('сезон pending → final отменой гонки без протокола — серверная выдача и push без GET', () => {
  it('конец сезона → сверка видит pending → отмена ждущей гонки → прогон → сезонная выдача origin server → push', async () => {
    const me = await rider(h, 'me@example.by');
    await seedPushToken(h, me.userId, 'me');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    const waitingRace = await seedProtocolRace(h, season, [], {
      protocol: false,
      corridor: { routeId: uuidv7(), widthM: 50, distanceM: 8000 },
    });
    await syncStandings(h);
    // первая сверка (GET) — маркер; сезон ждёт протокола — сезонных выдач нет
    expect((await authed(h, me, 'GET', ACHIEVEMENTS)).status).toBe(200);
    const seasonal = () => achievementsDb(h).seasonGrants.countDocuments({ userId: me.userId });
    expect(await seasonal()).toBe(0);
    const settle = ACHIEVEMENTS_SERVER_SYNC.settleMs + MINUTE;

    h.clock.advance(settle);
    await queue().add(ACHIEVEMENTS_SWEEP_JOB, {}, { jobId: 'sweep-pending' });
    const [pending, ...pendingRiders] = await completeQueued();
    expect(pending).toMatchObject({ enqueued: 1, read: { seasons: 1 } });
    expect(pendingRiders).toEqual(['reconciled']);
    expect(await seasonal()).toBe(0);
    const before = (await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED)).length;

    await racesDb(h).races.updateOne(
      { _id: waitingRace },
      { $set: { status: 'cancelled', cancelledAt: h.clock.now(), updatedAt: h.clock.now() } },
    );
    h.clock.advance(settle);
    await queue().add(ACHIEVEMENTS_SWEEP_JOB, {}, { jobId: 'sweep-final' });
    const [final, ...finalRiders] = await completeQueued();
    expect(final).toMatchObject({ enqueued: 1, read: { seasons: 1 } });
    expect(finalRiders).toEqual(['reconciled']);

    const events = (await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED)).slice(before);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((event) => AchievementsGrantNoticed.parse(event.payload))).toEqual(
      events.map(() => expect.objectContaining({ grant: 'season', origin: 'server' })),
    );
    for (const event of events) {
      expect(await runIntake(h, ACHIEVEMENTS_GRANT_NOTICED, event._id)).toBe('written');
    }
    const notices = await notificationsOf(h, me.userId);
    expect(notices).toContainEqual(
      expect.objectContaining({
        kind: 'achievement_granted',
        target: expect.objectContaining({ code: 'season_champion' }),
        push: expect.objectContaining({ state: 'pending' }),
      }),
    );
    await runPush(h, me.userId);
    expect(expo.delivered.length).toBeGreaterThan(0);
  });
});
