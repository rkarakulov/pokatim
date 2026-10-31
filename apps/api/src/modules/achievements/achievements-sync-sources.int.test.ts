import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Collection } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { daysAgo, pastRide, seedRouteRide } from '../../../test/achievements';
import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { uuidv7At } from '../../../test/notifications';
import { resultsDb } from '../../../test/results';
import { routeRidesDb, routeRidesRepository } from '../../../test/route-rides';
import { rider, ridesDb, type Rider } from '../../../test/rides';
import { racesDb } from '../../../test/races';
import { seedProtocolRace, seedSeason, standingsDb } from '../../../test/standings';
import type { ChangedCursor } from '../../changed-since';
import { RIDER_RESULTS, type RiderResults } from '../results';
import { RIDER_RIDES, type RiderRides } from '../rides';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from '../standings';

/**
 * Источники серверной сверки достижений (achievements-push N2, 5.D): по одному методу портов владельцев — окно
 * `(курсор, until]` по keyset, предел страницы, продолжение с курсора, строки за окном и «не тот факт» не читаются.
 */
let h: Harness;
let u1: Rider;
let u2: Rider;
let u3: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  u1 = await rider(h, 'u1@example.by');
  u2 = await rider(h, 'u2@example.by');
  u3 = await rider(h, 'u3@example.by');
});
afterAll(async () => {
  await h.close();
});

const port = <T>(token: symbol) => h.worker.get<T>(token, { strict: false });
const ago = (minutes: number) => new Date(h.clock.now().getTime() - minutes * MINUTE);
const start = (minutes: number): ChangedCursor => ({ at: ago(minutes), id: '' });
const sorted = (ids: string[]) => [...ids].sort();

describe('RIDER_RESULTS.revisedRidersAfter — журнал ревизий по uuidv7 _id', () => {
  /** Запись журнала «на момент» (uuidv7 базы берёт `Date.now()`, а не часы стенда) и строки ревизии. */
  async function revisionAt(at: Date, userIds: string[], revision: number | null = 1) {
    const raceId = uuidv7();
    const _id = uuidv7At(at);
    await resultsDb(h).recalculations.insertOne({
      _id,
      raceId,
      kind: revision === null ? 'recheck_started' : 'published',
      entryId: null,
      revision,
      reason: 'Протокол',
      actorUserId: uuidv7(),
      at,
    });
    if (revision !== null && userIds.length > 0) {
      await resultsDb(h).protocolRows.insertMany(
        userIds.map((userId, order) => ({
          _id: uuidv7(),
          raceId,
          revision,
          order,
          entryId: uuidv7(),
          userId,
          attemptId: uuidv7(),
          elapsedSec: 3600,
          startedAt: at,
          place: order + 1,
          tied: false,
          status: 'final' as const,
          groupKey: 'm_u40' as const,
          createdAt: at,
        })),
      );
    }
    return _id;
  }

  it('окно, страница, продолжение; перепроверка без ревизии и запись позже until — не читаются', async () => {
    const results = port<RiderResults>(RIDER_RESULTS);
    const a = await revisionAt(ago(5), [u1.userId, u2.userId]);
    await revisionAt(ago(4), [u3.userId], null);
    const b = await revisionAt(ago(3), [u3.userId]);
    await revisionAt(ago(-1), [u1.userId]);
    await revisionAt(ago(30), [u1.userId]);
    const until = h.clock.now();

    const all = await results.revisedRidersAfter(start(10), until, 10);
    expect(sorted(all.userIds)).toEqual(sorted([u1.userId, u2.userId, u3.userId]));
    expect(all).toMatchObject({ next: { id: b, at: ago(3) } });

    const first = await results.revisedRidersAfter(start(10), until, 1);
    expect(sorted(first.userIds)).toEqual(sorted([u1.userId, u2.userId]));
    expect(first).toMatchObject({ next: { id: a } });
    const second = await results.revisedRidersAfter(first.next!, until, 1);
    expect(second).toMatchObject({ userIds: [u3.userId], next: { id: b } });
    expect(await results.revisedRidersAfter(second.next!, until, 1)).toEqual({
      userIds: [],
      next: null,
    });
  });

  it('бюджет запросов: страница из нескольких ревизий — журнал и строки протоколов, по одному запросу', async () => {
    const results = port<RiderResults>(RIDER_RESULTS);
    for (const [minutes, who] of [
      [9, u1],
      [8, u2],
      [7, u3],
      [6, u1],
    ] as const) {
      await revisionAt(ago(minutes), [who.userId]);
    }
    const reads = (['find', 'findOne', 'aggregate', 'distinct', 'countDocuments'] as const).map(
      (method) => vi.spyOn(Collection.prototype, method),
    );
    const page = await results.revisedRidersAfter(start(10), h.clock.now(), 10);
    const queries = reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    vi.restoreAllMocks();
    expect(sorted(page.userIds)).toEqual(sorted([u1.userId, u2.userId, u3.userId]));
    expect(queries).toBe(2);
  });
});

describe('RIDER_RIDES.startedRidersAfter — старт опубликованного райда в окне', () => {
  it('участники и организатор; отменённый и будущий — нет; страница и продолжение', async () => {
    const rides = port<RiderRides>(RIDER_RIDES);
    const first = await pastRide(h, u1, [u2], 1);
    const cancelled = await pastRide(h, u3, [], 1);
    const second = await pastRide(h, u3, [], 1);
    const future = await pastRide(h, u2, [], 1);
    const set = (id: string, startsAt: Date, extra: Record<string, unknown> = {}) =>
      ridesDb(h).updateOne({ _id: id }, { $set: { startsAt, ...extra } });
    await set(first, ago(20));
    await set(cancelled, ago(15), { status: 'cancelled' });
    await set(second, ago(10));
    await set(future, ago(-5));
    const until = h.clock.now();

    const all = await rides.startedRidersAfter(start(60), until, 10);
    expect(sorted(all.userIds)).toEqual(sorted([u1.userId, u2.userId, u3.userId]));
    expect(all).toMatchObject({ next: { id: second, at: ago(10) } });

    const page = await rides.startedRidersAfter(start(60), until, 1);
    expect(sorted(page.userIds)).toEqual(sorted([u1.userId, u2.userId]));
    expect(page).toMatchObject({ next: { id: first } });
    expect(await rides.startedRidersAfter(page.next!, until, 1)).toMatchObject({
      userIds: [u3.userId],
      next: { id: second },
    });
    // райд старше окна (вчера) не читается
    expect((await rides.startedRidersAfter(start(15), until, 10)).userIds).toEqual([u3.userId]);
    expect(daysAgo(h, 1) < ago(60)).toBe(true);
  });
});

describe('RIDER_ROUTE_RIDES.passedRidersAfter — засчитанные заезды по моменту записи итога', () => {
  it('только passed в окне; страница и продолжение', async () => {
    const routeRides = port<RiderRouteRides>(RIDER_ROUTE_RIDES);
    const routeId = uuidv7();
    await seedRouteRide(h, u1.userId, routeId, daysAgo(h, 1));
    await seedRouteRide(h, u2.userId, routeId, daysAgo(h, 1));
    await seedRouteRide(h, u3.userId, routeId, daysAgo(h, 1), { status: 'not_passed' });
    await seedRouteRide(h, u3.userId, uuidv7(), daysAgo(h, 1));
    const docs = await routeRidesDb(h).rides.find({ status: 'passed' }).toArray();
    const at = new Map([
      [u1.userId, ago(5)],
      [u2.userId, ago(3)],
      [u3.userId, ago(-1)],
    ]);
    for (const doc of docs) {
      await routeRidesDb(h).rides.updateOne(
        { _id: doc._id },
        { $set: { checkedAt: at.get(doc.userId)!, updatedAt: at.get(doc.userId)! } },
      );
    }
    const until = h.clock.now();

    const all = await routeRides.passedRidersAfter(start(10), until, 10);
    expect(sorted(all.userIds)).toEqual(sorted([u1.userId, u2.userId]));
    expect(all).toMatchObject({ next: { at: ago(3) } });

    const page = await routeRides.passedRidersAfter(start(10), until, 1);
    expect(page).toMatchObject({ userIds: [u1.userId], next: { at: ago(5) } });
    expect(await routeRides.passedRidersAfter(page.next!, until, 1)).toMatchObject({
      userIds: [u2.userId],
    });
  });
  it('итог записан позже checkedAt больше чем на settleMs (ожидание семафора разбора) — читается по моменту записи', async () => {
    const routeRides = port<RiderRouteRides>(RIDER_ROUTE_RIDES);
    const repository = routeRidesRepository(h);
    const activityId = await seedRouteRide(h, u1.userId, uuidv7(), daysAgo(h, 1), {
      status: 'queued',
    });
    const doc = (await routeRidesDb(h).rides.findOne({ activityId }))!;
    await routeRidesDb(h).rides.updateOne({ _id: doc._id }, { $set: { status: 'checking' } });
    // проверка начата 10 мин назад, итог записан 3 мин назад; курсор уже за моментом начала проверки
    const recorded = await repository.record(
      doc._id,
      doc.checkRevision,
      {
        status: 'passed',
        reasons: [],
        failure: null,
        segment: null,
        touchedCorridor: true,
        engineVersion: 1,
        trackMap: null,
        checkedAt: ago(10),
      },
      ago(3),
    );
    expect(recorded).toBe(true);
    expect(await routeRides.passedRidersAfter(start(5), h.clock.now(), 10)).toEqual({
      userIds: [u1.userId],
      next: { at: ago(3), id: doc._id },
    });
  });
});

describe('RIDER_SEASON_STANDINGS.settledRidersAfter — пересчёт снимка или конец сезона', () => {
  async function snapshot(seasonId: string, computedAt: Date, userIds: string[]) {
    await standingsDb(h).seasons.insertOne({
      _id: seasonId,
      formulaVersion: 1,
      sourceVersion: 1,
      fingerprint: 'f',
      computedAt,
      races: [],
      tables: [],
    });
    if (userIds.length === 0) return;
    await standingsDb(h).rows.insertMany(
      userIds.map((userId, order) => ({
        _id: uuidv7(),
        seasonId,
        bikeClass: 'road' as const,
        groupKey: 'm_u40' as const,
        order,
        userId,
        place: order + 1,
        tied: false,
        points: 10,
        cells: [],
      })),
    );
  }

  it('завершённый сезон, пересчитанный в окне; текущий — нет; продолжение внутри сезона по userId', async () => {
    const standings = port<RiderSeasonStandings>(RIDER_SEASON_STANDINGS);
    const finished = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const current = await seedSeason(h, 'Сезон 2026');
    const old = await seedSeason(h, 'Сезон 2024', { year: 2024 });
    const users = sorted([u1.userId, u2.userId, u3.userId]);
    await snapshot(finished, ago(5), users);
    await snapshot(current, ago(5), [u1.userId]);
    await snapshot(old, new Date('2024-12-01T00:00:00Z'), [u1.userId]);
    const until = h.clock.now();

    const all = await standings.settledRidersAfter(start(10), until, 10);
    expect(sorted(all.userIds)).toEqual(users);
    expect(all).toEqual({ userIds: users, next: { at: ago(5), id: finished } });

    const first = await standings.settledRidersAfter(start(10), until, 2);
    expect(first).toEqual({
      userIds: users.slice(0, 2),
      next: { at: ago(5), id: `${finished}|${users[1]}` },
    });
    const second = await standings.settledRidersAfter(first.next!, until, 2);
    expect(second).toEqual({
      userIds: users.slice(2),
      next: { at: ago(5), id: finished },
    });
    expect(await standings.settledRidersAfter(second.next!, until, 2)).toEqual({
      userIds: [],
      next: null,
    });
  });

  it('снимок, пересчитанный до конца сезона, — событие в момент конца сезона', async () => {
    const standings = port<RiderSeasonStandings>(RIDER_SEASON_STANDINGS);
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await snapshot(season, new Date('2025-09-01T00:00:00Z'), [u1.userId]);
    const endsBefore = new Date('2025-10-31T21:00:00Z');
    const around = { at: new Date(endsBefore.getTime() - MINUTE), id: '' };
    expect(await standings.settledRidersAfter(around, h.clock.now(), 10)).toEqual({
      userIds: [u1.userId],
      next: { at: endsBefore, id: season },
    });
    expect(
      (await standings.settledRidersAfter({ at: endsBefore, id: season }, h.clock.now(), 10))
        .userIds,
    ).toEqual([]);
  });

  it('отмена последней гонки без протокола после конца сезона (pending → final) — событие в момент отмены', async () => {
    const standings = port<RiderSeasonStandings>(RIDER_SEASON_STANDINGS);
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await snapshot(season, new Date('2025-11-01T00:00:00Z'), [u1.userId]);
    const corridor = { routeId: uuidv7(), widthM: 50, distanceM: 8000 };
    const waiting = await seedProtocolRace(h, season, [], { protocol: false, corridor });
    // отменённый анонс (без коридора) итог сезона не держал — событие не двигает
    await seedProtocolRace(h, season, [], { protocol: false, status: 'cancelled' });
    const passed = { at: new Date('2025-11-01T00:00:00Z'), id: season };
    expect((await standings.settledRidersAfter(passed, h.clock.now(), 10)).userIds).toEqual([]);

    await racesDb(h).races.updateOne(
      { _id: waiting },
      { $set: { status: 'cancelled', cancelledAt: ago(5), updatedAt: ago(5) } },
    );
    expect(await standings.settledRidersAfter(passed, h.clock.now(), 10)).toEqual({
      userIds: [u1.userId],
      next: { at: ago(5), id: season },
    });
    // до settle-границы отмена не видна
    expect((await standings.settledRidersAfter(passed, ago(6), 10)).userIds).toEqual([]);
  });
});
