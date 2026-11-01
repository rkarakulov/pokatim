import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { collections } from '../../../test/identity';
import { catalogCorridorRoute } from '../../../test/route-rides';
import { createRide, hideInDb, ridesDb, startsIn } from '../../../test/rides';
import {
  DAY,
  HOUR,
  riders,
  ridesAhead,
  socialDb,
  socialServices,
  travelPast,
} from '../../../test/social';
import { AttendanceRepository } from './attendance.repository';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import { eventsOfType } from '../../../test/notifications';
import type { RideAsk } from './ride-ask.port';
import { RideAskSweep } from './ride-ask-sweep';
import { SOCIAL_RIDE_ASK_DUE, SocialRideAskDue } from './social.events';

/**
 * Регламент «Как прошёл райд?» (K10, P5, AC5): через 4 ч после старта — участники «Иду» без записи явки, один раз на
 * райд (захват `askedAt`), окно догона 24 ч, отменённый и скрытый — нет; точка привязки P7 `RIDE_ASK_DUE`.
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

const sweep = () => h.worker.get(RideAskSweep);
/** Адресаты, записанные в outbox `social.ride-ask-due` (P7: точка `RIDE_ASK_DUE` — outbox в транзакции захвата). */
const asks = async () =>
  (await eventsOfType(h, SOCIAL_RIDE_ASK_DUE)).map((event): RideAsk =>
    SocialRideAskDue.parse(event.payload),
  );
const askedAt = async (rideId: string) =>
  (await socialDb(h).attendance.findOne({ _id: rideId }))?.askedAt ?? null;

describe('AC5 — адресаты через 4 ч после старта', () => {
  it('явка и «Меня не было» не попадают; до +4 ч вызова нет, в +4 ч — один вызов, askedAt стоит', async () => {
    const [org, p1, p2, p3] = await riders(h, 'org', 'p1', 'p2', 'p3');
    // без маршрута — точного старта нет, райд всё равно отбирается (§8)
    const [ride] = await ridesAhead(h, org, [p1, p2, p3], 1);
    travelPast(h, ride!.startsAt, HOUR);
    expect(await socialServices(h).attendance.markManual(org.userId, ride!.id)).toBe(true);
    expect(await socialServices(h).attendance.unmark(p1.userId, ride!.id)).toBe(true);

    travelPast(h, ride!.startsAt, 4 * HOUR - MINUTE);
    expect(await sweep().run()).toEqual({ rides: 0, asked: 0, recipients: 0, failed: 0 });
    expect(await asks()).toEqual([]);
    expect(await askedAt(ride!.id)).toBeNull();

    travelPast(h, ride!.startsAt, 4 * HOUR);
    expect(await sweep().run()).toEqual({ rides: 1, asked: 1, recipients: 2, failed: 0 });
    expect(await asks()).toEqual([{ rideId: ride!.id, userIds: [p2.userId, p3.userId] }]);
    expect(await askedAt(ride!.id)).toEqual(h.clock.now());

    // повтор — без вызова
    h.clock.advance(30 * MINUTE);
    expect(await sweep().run()).toEqual({ rides: 0, asked: 0, recipients: 0, failed: 0 });
    expect(await asks()).toHaveLength(1);
  });

  it('две run() параллельно — один вызов', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [ride] = await ridesAhead(h, org, [p1], 1);
    travelPast(h, ride!.startsAt, 4 * HOUR);
    const runs = await Promise.all([sweep().run(), sweep().run()]);
    expect(runs.reduce((sum, run) => sum + run.rides, 0)).toBe(1);
    expect(await asks()).toEqual([{ rideId: ride!.id, userIds: [org.userId, p1.userId] }]);
  });

  it('захват держит «один раз» и без предфильтра askedAmong (прогон, прочитавший райд до чужого захвата)', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [ride] = await ridesAhead(h, org, [p1], 1);
    travelPast(h, ride!.startsAt, 4 * HOUR);
    await sweep().run();
    const claimedAt = await askedAt(ride!.id);
    vi.spyOn(h.worker.get(AttendanceRepository), 'askedAmong').mockResolvedValue(new Set());
    h.clock.advance(30 * MINUTE);
    expect(await sweep().run()).toEqual({ rides: 0, asked: 0, recipients: 0, failed: 0 });
    expect(await asks()).toHaveLength(1);
    expect(await askedAt(ride!.id)).toEqual(claimedAt);
  });

  it('отменённый и скрытый — нет вызова и нет askedAt', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [cancelled, hidden] = await ridesAhead(h, org, [p1], 2);
    await ridesDb(h).updateOne({ _id: cancelled!.id }, { $set: { status: 'cancelled' } });
    await hideInDb(h, hidden!.id);
    travelPast(h, cancelled!.startsAt, 4 * HOUR);
    await sweep().run();
    travelPast(h, hidden!.startsAt, 4 * HOUR);
    await sweep().run();
    expect(await asks()).toEqual([]);
    expect(await askedAt(cancelled!.id)).toBeNull();
    expect(await askedAt(hidden!.id)).toBeNull();
  });

  it('догон: прогон через +4 ч + 23 ч — вызов; через +4 ч + 24 ч + 1 мин — нет, askedAt не ставится', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [late, missed] = await ridesAhead(h, org, [p1], 2);
    travelPast(h, late!.startsAt, 4 * HOUR + 23 * HOUR);
    await sweep().run();
    expect((await asks()).map((ask) => ask.rideId)).toEqual([late!.id]);

    travelPast(h, missed!.startsAt, 4 * HOUR + 24 * HOUR + MINUTE);
    expect(await sweep().run()).toEqual({ rides: 0, asked: 0, recipients: 0, failed: 0 });
    expect((await asks()).map((ask) => ask.rideId)).toEqual([late!.id]);
    expect(await askedAt(missed!.id)).toBeNull();
  });

  it('все явились — askedAt стоит, вызова нет', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [ride] = await ridesAhead(h, org, [p1], 1);
    travelPast(h, ride!.startsAt, HOUR);
    await socialServices(h).attendance.markManual(org.userId, ride!.id);
    await socialServices(h).attendance.markManual(p1.userId, ride!.id);
    travelPast(h, ride!.startsAt, 4 * HOUR);
    expect(await sweep().run()).toEqual({ rides: 1, asked: 0, recipients: 0, failed: 0 });
    expect(await asks()).toEqual([]);
    expect(await askedAt(ride!.id)).toEqual(h.clock.now());
  });

  it('удалённый аккаунт (deletedAt) в адресаты не попадает', async () => {
    const [org, p1, p2] = await riders(h, 'org', 'p1', 'p2');
    const [ride] = await ridesAhead(h, org, [p1, p2], 1);
    await collections(h).users.updateOne(
      { _id: p1.userId },
      { $set: { deletedAt: h.clock.now() } },
    );
    travelPast(h, ride!.startsAt, 4 * HOUR);
    await sweep().run();
    expect(await asks()).toEqual([{ rideId: ride!.id, userIds: [org.userId, p2.userId] }]);
  });

  it('райд маршрута каталога (точный старт) — отбирается так же', async () => {
    const [org] = await riders(h, 'org');
    const routeId = await catalogCorridorRoute(h, org.userId);
    const ride = await createRide(h, org, { routeId, limit: null, startsAt: startsIn(h, DAY) });
    travelPast(h, new Date(ride.startsAt), 4 * HOUR);
    await sweep().run();
    expect(await asks()).toEqual([{ rideId: ride.id, userIds: [org.userId] }]);
  });

  it('явка после захвата адресатов не меняет; ручная отметка работает (askedAt её не ломает)', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [ride] = await ridesAhead(h, org, [p1], 1);
    travelPast(h, ride!.startsAt, 4 * HOUR);
    await sweep().run();
    const claimedAt = await askedAt(ride!.id);
    expect(claimedAt).not.toBeNull();

    h.clock.advance(HOUR);
    expect(await socialServices(h).attendance.markManual(p1.userId, ride!.id)).toBe(true);
    const doc = await socialDb(h).attendance.findOne({ _id: ride!.id });
    expect(doc?.entries.map((entry) => entry.userId)).toEqual([p1.userId]);
    expect(doc?.askedAt).toEqual(claimedAt);
    expect(doc?.updatedAt).toEqual(h.clock.now());
    await sweep().run();
    expect(await asks()).toEqual([{ rideId: ride!.id, userIds: [org.userId, p1.userId] }]);
  });

  it('сбой записи outbox — захват askedAt откатывается, следующий прогон спрашивает (P7)', async () => {
    const [org, p1] = await riders(h, 'org', 'p1');
    const [ride] = await ridesAhead(h, org, [p1], 1);
    travelPast(h, ride!.startsAt, 4 * HOUR);
    const outbox = h.worker.get(MongoOutboxWriter);
    vi.spyOn(outbox, 'append').mockRejectedValueOnce(new Error('outbox down'));
    await expect(sweep().run()).rejects.toThrow('social.ride-ask: 1 ride(s) failed');
    expect(await askedAt(ride!.id)).toBeNull();
    expect(await asks()).toEqual([]);

    h.clock.advance(30 * MINUTE);
    expect(await sweep().run()).toMatchObject({ rides: 1, asked: 1, recipients: 2 });
    expect(await asks()).toEqual([{ rideId: ride!.id, userIds: [org.userId, p1.userId] }]);
  });
});
