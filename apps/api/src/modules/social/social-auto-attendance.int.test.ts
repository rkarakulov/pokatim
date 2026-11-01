import { rm } from 'node:fs/promises';

import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { collections, outboxEvents } from '../../../test/identity';
import { CORRIDOR, importRide, rideGpx, signIn, uploadRide } from '../../../test/results';
import { catalogCorridorRoute } from '../../../test/route-rides';
import {
  createRide,
  hideInDb,
  join,
  ridesDb,
  setRouteStart,
  startsIn,
  type Rider,
} from '../../../test/rides';
import { DAY, HOUR, riders, socialDb, socialServices, travelPast } from '../../../test/social';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { tracks } from '../../../test/tracks';
import { RIDES_FOR_SOCIAL, type RidesForSocial } from '../rides';
import { SocialIntakeProcessor } from './social-intake.processor';

/**
 * Автоявка по заезду (K2, P5): `tracks.activity-ready` → `social-intake` → явка `via: track` и связи `ride` (AC1),
 * отказы сверки (AC2), идемпотентность (AC3), устаревшие факты райда (RC-P5-5), удалённый владелец (RC-P5-6).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
  handled.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const READY = 'tracks.activity-ready';
const handled = new Set<string>();
const job = (name: string, outboxEventId: string) =>
  ({ name, data: { outboxEventId }, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job;

/** Задачи `social-intake` по новым событиям `tracks.activity-ready` (как публикатор + worker), каждое — один раз. */
async function runIntake(): Promise<string[]> {
  const processor = h.worker.get(SocialIntakeProcessor);
  const outcomes: string[] = [];
  for (const event of await outboxEvents(h)) {
    if (event.type !== READY || handled.has(event._id)) continue;
    handled.add(event._id);
    outcomes.push(await processor.process(job(event.type, event._id)));
  }
  return outcomes;
}

/** Id событий `tracks.activity-ready` по активности. */
async function readyEventOf(activityId: string): Promise<string> {
  const event = (await outboxEvents(h)).find(
    (row) =>
      row.type === READY && (row.payload as { activityId: string }).activityId === activityId,
  );
  if (!event) throw new Error('нет события activity-ready');
  return event._id;
}

/** Райд маршрута каталога (точный старт — старт эталона) через `offsetMs`; участники отмечаются «Иду». */
async function catalogRide(
  organizer: Rider,
  participants: readonly Rider[],
  options: { offsetMs?: number; routeId?: string } = {},
): Promise<{ id: string; startsAt: Date }> {
  const routeId = options.routeId ?? (await catalogCorridorRoute(h, organizer.userId));
  const ride = await createRide(h, organizer, {
    routeId,
    limit: null,
    startsAt: startsIn(h, options.offsetMs ?? DAY),
  });
  for (const who of participants) expect((await join(h, who, ride.id)).status).toBe(200);
  return { id: ride.id, startsAt: new Date(ride.startsAt) };
}

/** Заезд эталона со стартом `startAt` (вход заново: часы стенда сдвинуты). */
async function ride(
  name: string,
  startAt: Date,
  options: Parameters<typeof rideGpx>[2] = {},
): Promise<{ activityId: string; uploadId: string }> {
  const auth = await signIn(h, `${name}@example.by`);
  const result = await uploadRide(h, auth, rideGpx('clean.gpx', startAt, options));
  if (!result.activityId) throw new Error(`заезд: ${result.outcome}`);
  return { activityId: result.activityId, uploadId: result.uploadId };
}

const at = (base: Date, offsetMs: number) => new Date(base.getTime() + offsetMs);
const entries = async (rideId: string) =>
  (await socialDb(h).attendance.findOne({ _id: rideId }))?.entries ?? [];
const markedEvents = () =>
  socialDb(h)
    .events.find({ type: 'attendance-marked' }, { projection: { _id: 0, userId: 1, props: 1 } })
    .toArray();
const rideConnections = () =>
  socialDb(h)
    .connections.find({}, { projection: { _id: 0, ownerId: 1, otherId: 1, rideCount: 1 } })
    .sort({ ownerId: 1, otherId: 1 })
    .toArray();
/** Состояние «Свои» без служебных полей: явка, связи, журнал метрик. */
const snapshot = async () => ({
  attendance: await socialDb(h).attendance.find().toArray(),
  connections: await socialDb(h).connections.find().toArray(),
  events: await socialDb(h).events.find().toArray(),
});

describe('AC1 — велозаезд в окне и радиусе райда с точным стартом', () => {
  it('явка обоих via: track, связи ride в обе стороны, attendance-marked {via: track} — по одному', async () => {
    const [org, a, b] = await riders(h, 'org', 'a', 'b');
    const target = await catalogRide(org, [a, b]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE));
    await ride('b', at(target.startsAt, -10 * MINUTE));

    expect(await runIntake()).toEqual(['marked', 'marked']);

    expect(
      (await entries(target.id)).map(({ userId, via, declinedAt }) => ({
        userId,
        via,
        declinedAt,
      })),
    ).toEqual([
      { userId: a.userId, via: 'track', declinedAt: null },
      { userId: b.userId, via: 'track', declinedAt: null },
    ]);
    expect(await rideConnections()).toEqual(
      [
        { ownerId: a.userId, otherId: b.userId, rideCount: 1 },
        { ownerId: b.userId, otherId: a.userId, rideCount: 1 },
      ].sort((x, y) => (x.ownerId < y.ownerId ? -1 : 1)),
    );
    const events = await markedEvents();
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        { userId: a.userId, props: { via: 'track' } },
        { userId: b.userId, props: { via: 'track' } },
      ]),
    );
  });

  it('два подходящих райда (старты через час) — явка в обоих', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const routeId = await catalogCorridorRoute(h, org.userId);
    const first = await catalogRide(org, [a], { routeId });
    const second = await catalogRide(org, [a], { routeId, offsetMs: DAY + HOUR });
    travelPast(h, second.startsAt, 3 * HOUR);
    await ride('a', at(first.startsAt, 50 * MINUTE));

    expect(await runIntake()).toEqual(['marked']);
    expect((await entries(first.id)).map((entry) => entry.userId)).toEqual([a.userId]);
    expect((await entries(second.id)).map((entry) => entry.userId)).toEqual([a.userId]);
    expect(await markedEvents()).toHaveLength(2);
  });
});

describe('AC2 — не засчитывается', () => {
  /** Заезд в окне не дал явки: записей явки и событий `attendance-marked` нет. */
  async function expectNoAttendance(rideId: string, outcomes: string[], expected: string[]) {
    expect(outcomes).toEqual(expected);
    expect(await entries(rideId)).toEqual([]);
    expect(await markedEvents()).toEqual([]);
  }

  it('не cycling (type: running)', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE), { type: 'running' });
    await expectNoAttendance(target.id, await runIntake(), ['not_cycling']);
  });

  it('вне окна по времени: −31 мин и +2 ч 1 мин', async () => {
    const [org, a, b] = await riders(h, 'org', 'a', 'b');
    const target = await catalogRide(org, [a, b]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, -31 * MINUTE));
    await ride('b', at(target.startsAt, 2 * HOUR + MINUTE));
    await expectNoAttendance(target.id, await runIntake(), ['no_rides', 'no_rides']);
  });

  it('дальше 500 м от точки старта райда (~600 м)', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const routeId = await catalogCorridorRoute(h, org.userId);
    const [lon, lat] = CORRIDOR.line[0]!;
    await setRouteStart(h, routeId, [lon, lat + 600 / 111_195]);
    const target = await catalogRide(org, [a], { routeId });
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE));
    await expectNoAttendance(target.id, await runIntake(), ['unchanged']);
  });

  it('райд без маршрута (нет точного старта)', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const plain = await createRide(h, org, { limit: null, startsAt: startsIn(h, DAY) });
    expect((await join(h, a, plain.id)).status).toBe(200);
    const startsAt = new Date(plain.startsAt);
    travelPast(h, startsAt, 3 * HOUR);
    await ride('a', at(startsAt, 5 * MINUTE));
    await expectNoAttendance(plain.id, await runIntake(), ['unchanged']);
  });

  it('отменённый и скрытый райд', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const routeId = await catalogCorridorRoute(h, org.userId);
    const cancelled = await catalogRide(org, [a], { routeId });
    const hidden = await catalogRide(org, [a], { routeId, offsetMs: DAY + HOUR });
    await ridesDb(h).updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });
    await hideInDb(h, hidden.id);
    travelPast(h, hidden.startsAt, 3 * HOUR);
    await ride('a', at(cancelled.startsAt, 45 * MINUTE));
    await expectNoAttendance(cancelled.id, await runIntake(), ['unchanged']);
    expect(await entries(hidden.id)).toEqual([]);
  });

  it('не участник', async () => {
    const [org, a, stranger] = await riders(h, 'org', 'a', 'stranger');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('stranger', at(target.startsAt, 5 * MINUTE));
    expect(stranger.userId).not.toBe(a.userId);
    await expectNoAttendance(target.id, await runIntake(), ['no_rides']);
  });

  it('задача обработана позже 7 дней после старта райда', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE));
    travelPast(h, target.startsAt, 7 * DAY + MINUTE);
    await expectNoAttendance(target.id, await runIntake(), ['unchanged']);
  });

  it('«Меня не было» до загрузки — запись с declinedAt не перекрывается', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    expect(await socialServices(h).attendance.unmark(a.userId, target.id)).toBe(true);
    await ride('a', at(target.startsAt, 5 * MINUTE));

    expect(await runIntake()).toEqual(['unchanged']);
    expect((await entries(target.id)).map((entry) => entry.declinedAt !== null)).toEqual([true]);
    expect(await markedEvents()).toEqual([]);
  });

  it('дубль: событие дубля засчитывает основную группы, итог один', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    const gpx = rideGpx('clean.gpx', at(target.startsAt, 5 * MINUTE), { power: true });
    const primary = await uploadRide(h, await signIn(h, 'a@example.by'), gpx);
    const duplicate = await importRide(h, a.userId, gpx, { hasHeartRate: false, hasPower: false });
    expect(duplicate.activityId).not.toBe(primary.activityId);

    // сначала — событие дубля: явка по основной
    const processor = h.worker.get(SocialIntakeProcessor);
    const duplicateEvent = await readyEventOf(duplicate.activityId!);
    handled.add(duplicateEvent);
    expect(await processor.process(job(READY, duplicateEvent))).toBe('marked');
    expect(await runIntake()).toEqual(['unchanged']);
    expect(await entries(target.id)).toHaveLength(1);
    expect(await markedEvents()).toHaveLength(1);
  });
});

describe('AC3 — повтор задачи и новое событие той же группы', () => {
  it('состояние явки, связи и product_events не меняются', async () => {
    const [org, a, b] = await riders(h, 'org', 'a', 'b');
    const target = await catalogRide(org, [a, b]);
    travelPast(h, target.startsAt, 3 * HOUR);
    const gpx = rideGpx('clean.gpx', at(target.startsAt, 5 * MINUTE), { power: true });
    const first = await uploadRide(h, await signIn(h, 'a@example.by'), gpx);
    await ride('b', at(target.startsAt, 5 * MINUTE));
    expect(await runIntake()).toEqual(['marked', 'marked']);
    const before = await snapshot();

    // повтор той же задачи (тот же outboxEventId)
    const processor = h.worker.get(SocialIntakeProcessor);
    expect(await processor.process(job(READY, await readyEventOf(first.activityId!)))).toBe(
      'unchanged',
    );
    // новое событие той же группы — импорт дубля
    await importRide(h, a.userId, gpx, { hasHeartRate: false, hasPower: false });
    expect(await runIntake()).toEqual(['unchanged']);

    expect(await snapshot()).toEqual(before);
  });
});

describe('RC-P5-5, RC-P5-6 — состояние сменилось после чтения', () => {
  it('райд отменён между чтением фактов и записью — итог без броска, явки нет', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE));
    const port = h.worker.get<RidesForSocial>(RIDES_FOR_SOCIAL, { strict: false });
    const original = port.ridesOfParticipant.bind(port);
    vi.spyOn(port, 'ridesOfParticipant').mockImplementation(async (...args) => {
      const stale = await original(...args);
      await ridesDb(h).updateOne({ _id: target.id }, { $set: { status: 'cancelled' } });
      return stale;
    });

    expect(await runIntake()).toEqual(['unchanged']);
    expect(await entries(target.id)).toEqual([]);
    expect(await markedEvents()).toEqual([]);
  });

  it('владелец заезда помечен удалённым — user_deleted, записи нет', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    await ride('a', at(target.startsAt, 5 * MINUTE));
    await collections(h).users.updateOne({ _id: a.userId }, { $set: { deletedAt: h.clock.now() } });

    expect(await runIntake()).toEqual(['user_deleted']);
    expect(await entries(target.id)).toEqual([]);
  });

  it('активности уже нет (загрузка удалена) — no_activity', async () => {
    const [org, a] = await riders(h, 'org', 'a');
    const target = await catalogRide(org, [a]);
    travelPast(h, target.startsAt, 3 * HOUR);
    const { activityId } = await ride('a', at(target.startsAt, 5 * MINUTE));
    const event = await readyEventOf(activityId);
    await tracks(h).activities.deleteOne({ _id: activityId });

    handled.add(event);
    expect(await h.worker.get(SocialIntakeProcessor).process(job(READY, event))).toBe(
      'no_activity',
    );
    expect(await entries(target.id)).toEqual([]);
  });
});
