import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate, retried, untilBlocked } from '../../../test/identity';
import { hideInDb, ridesDb } from '../../../test/rides';
import {
  DAY,
  HOUR,
  pastRide,
  riders,
  ridesAhead,
  socialDb,
  socialServices,
  travelPast,
} from '../../../test/social';
import type { ProductEventType } from '../product-events';
import { AttendanceRepository } from './attendance.repository';

/**
 * Явка на райде (K2, RC-2a, RC-3a, AC3): окна и роли ручной отметки, отменённый и скрытый райд, идемпотентность,
 * пересчёт связей `ride` при снятии явки, `declinedAt` и явка по треку, гонка двух отметок одного райда.
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

const svc = () => socialServices(h).attendance;
const blocked = (reason: string) => ({
  code: 'SOCIAL_ACTION_BLOCKED',
  status: 409,
  details: { reason },
});

/** Связь пары: число общих райдов и последний (нет документа — `null`). */
async function pair(ownerId: string, otherId: string) {
  const doc = await socialDb(h).connections.findOne({ ownerId, otherId });
  return doc && { rideCount: doc.rideCount, lastRideAt: doc.lastRideAt, rides: doc.rides.length };
}

const eventsOf = (type: ProductEventType) => socialDb(h).events.countDocuments({ type });

describe('ручная явка: окно, роли, фаза (K2, RC-15)', () => {
  it('до старта — attendance_window; от старта до +7 дн — можно; позже — attendance_window', async () => {
    const [org, b] = await riders(h, 'org', 'b');
    const ride = await pastRide(h, org, [b], -HOUR);
    await expect(svc().markManual(b.userId, ride.id)).rejects.toMatchObject(
      blocked('attendance_window'),
    );
    h.clock.advance(HOUR);
    expect(await svc().markManual(b.userId, ride.id)).toBe(true);
    h.clock.advance(7 * DAY);
    expect(await svc().markManual(org.userId, ride.id)).toBe(true);
    h.clock.advance(1);
    await expect(svc().unmark(b.userId, ride.id)).rejects.toMatchObject(
      blocked('attendance_window'),
    );
  });

  it('организатор и «Иду» — можно; не участник — not_participant; неизвестный райд — NOT_FOUND', async () => {
    const [org, b, stranger] = await riders(h, 'org', 'b', 'stranger');
    const ride = await pastRide(h, org, [b]);
    expect(await svc().markManual(org.userId, ride.id)).toBe(true);
    await expect(svc().markManual(stranger.userId, ride.id)).rejects.toMatchObject(
      blocked('not_participant'),
    );
    await expect(svc().markManual(b.userId, uuidv7())).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('отменённый и скрытый — ride_unavailable; явка до скрытия и связи остаются (RC-15)', async () => {
    const [org, b] = await riders(h, 'org', 'b');
    const ride = await pastRide(h, org, [b]);
    await svc().markManual(org.userId, ride.id);
    await svc().markManual(b.userId, ride.id);
    const restore = await hideInDb(h, ride.id);
    await expect(svc().unmark(b.userId, ride.id)).rejects.toMatchObject(
      blocked('ride_unavailable'),
    );
    expect(await pair(org.userId, b.userId)).toMatchObject({ rideCount: 1 });
    await restore();
    await ridesDb(h).updateOne({ _id: ride.id }, { $set: { status: 'cancelled' } });
    await expect(svc().markManual(b.userId, ride.id)).rejects.toMatchObject(
      blocked('ride_unavailable'),
    );
  });
});

describe('пересчёт связей ride (K2, AC3)', () => {
  it('повтор отметки идемпотентен: нет дублей пар и событий', async () => {
    const [org, b] = await riders(h, 'org', 'b');
    const ride = await pastRide(h, org, [b]);
    expect(await svc().markManual(org.userId, ride.id)).toBe(true);
    expect(await svc().markManual(b.userId, ride.id)).toBe(true);
    const snapshot = async () => ({
      connections: await socialDb(h).connections.find().sort({ _id: 1 }).toArray(),
      events: await socialDb(h).events.countDocuments(),
    });
    const before = await snapshot();
    expect(before.connections).toHaveLength(2);
    // документ пары из pipeline-upsert: uuid-строка `_id`, nullable — явным null
    expect(before.connections[0]).toEqual({
      _id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      ownerId: expect.any(String),
      otherId: expect.any(String),
      rides: [{ rideId: ride.id, at: ride.startsAt }],
      rideCount: 1,
      lastRideAt: ride.startsAt,
      inviteAt: null,
      manualAt: null,
      removedAt: null,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    });
    expect(await eventsOf('connection-created')).toBe(2);
    expect(await eventsOf('attendance-marked')).toBe(2);

    expect(await svc().markManual(b.userId, ride.id)).toBe(false);
    expect(await svc().markByTrack(b.userId, ride.id)).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it('3 райдера, 2 райда: rideCount и lastRideAt у всех пар; снятие явки пересчитывает; без источников — удаляется', async () => {
    const [a, b, c] = await riders(h, 'a', 'b', 'c');
    const [first, second] = await ridesAhead(h, a, [b, c], 2);
    if (!first || !second) throw new Error('нет райдов');
    travelPast(h, first.startsAt);
    for (const who of [a, b, c]) await svc().markManual(who.userId, first.id);
    travelPast(h, second.startsAt);
    for (const who of [a, b, c]) await svc().markManual(who.userId, second.id);

    for (const [x, y] of [
      [a, b],
      [b, a],
      [a, c],
      [c, a],
      [b, c],
      [c, b],
    ] as const) {
      expect(await pair(x.userId, y.userId)).toEqual({
        rideCount: 2,
        lastRideAt: second.startsAt,
        rides: 2,
      });
    }

    // «Меня не было» у C на втором — пары C на втором сняты в обе стороны, A↔B не тронуты
    expect(await svc().unmark(c.userId, second.id)).toBe(true);
    for (const [x, y] of [
      [a, c],
      [c, a],
      [b, c],
      [c, b],
    ] as const) {
      expect(await pair(x.userId, y.userId)).toEqual({
        rideCount: 1,
        lastRideAt: first.startsAt,
        rides: 1,
      });
    }
    expect(await pair(a.userId, b.userId)).toMatchObject({ rideCount: 2 });

    // «Меня не было» у B на втором — у A↔B остаётся первый райд
    expect(await svc().unmark(b.userId, second.id)).toBe(true);
    expect(await pair(a.userId, b.userId)).toEqual({
      rideCount: 1,
      lastRideAt: first.startsAt,
      rides: 1,
    });
    // на втором остался один A — пар второго райда нет
    expect(await socialDb(h).connections.countDocuments({ 'rides.rideId': second.id })).toBe(0);
  });

  it('снятие единственной общей явки — документ без источников удаляется; с надгробием removedAt — остаётся', async () => {
    const [a, b] = await riders(h, 'a', 'b');
    const ride = await pastRide(h, a, [b]);
    await svc().markManual(a.userId, ride.id);
    await svc().markManual(b.userId, ride.id);
    await socialServices(h).connections.remove(b.userId, a.userId);

    expect(await svc().unmark(a.userId, ride.id)).toBe(true);
    expect(await pair(a.userId, b.userId)).toBeNull();
    expect(await socialDb(h).connections.findOne({ ownerId: b.userId })).toMatchObject({
      rideCount: 0,
      removedAt: expect.any(Date),
    });
  });
});

describe('«Меня не было» и явка по треку (RC-3a)', () => {
  it('declinedAt закрывает автоявку; «Я был» сбрасывает; трек без окна ручной правки', async () => {
    const [org, b, c] = await riders(h, 'org', 'b', 'c');
    const ride = await pastRide(h, org, [b, c]);
    await svc().markManual(org.userId, ride.id);

    // явка по треку, затем «Меня не было» — снята, запись с declinedAt
    expect(await svc().markByTrack(b.userId, ride.id)).toBe(true);
    expect(await svc().unmark(b.userId, ride.id)).toBe(true);
    expect(await svc().unmark(b.userId, ride.id)).toBe(false);
    expect(await pair(org.userId, b.userId)).toBeNull();
    expect(await svc().markByTrack(b.userId, ride.id)).toBe(false);
    expect(await pair(org.userId, b.userId)).toBeNull();

    // ручное «Я был» сбрасывает declinedAt
    expect(await svc().markManual(b.userId, ride.id)).toBe(true);
    expect(await pair(org.userId, b.userId)).toMatchObject({ rideCount: 1 });
    const doc = await socialDb(h).attendance.findOne({ _id: ride.id });
    expect(doc?.entries.find((entry) => entry.userId === b.userId)).toMatchObject({
      via: 'manual',
      declinedAt: null,
    });

    // трек приходит позже окна ручной правки — явка ставится
    h.clock.advance(30 * DAY);
    expect(await svc().markByTrack(c.userId, ride.id)).toBe(true);
    expect(await pair(c.userId, b.userId)).toMatchObject({ rideCount: 1 });
    expect(
      await socialDb(h).events.countDocuments({
        type: 'attendance-marked',
        userId: c.userId,
        props: { via: 'track' },
      }),
    ).toBe(1);
  });
});

describe('гонка двух отметок одного райда (RC-2)', () => {
  it('A остановлена между записью явки и чтением явившихся, B отмечается — пара A↔B есть', async () => {
    const [a, b] = await riders(h, 'a', 'b');
    const ride = await pastRide(h, a, [b]);
    const repository = h.worker.get(AttendanceRepository);
    const original = repository.attendees.bind(repository);
    const hold = gate();
    let held = false;
    const writes = vi.spyOn(repository, 'markManual');
    vi.spyOn(repository, 'attendees').mockImplementation(async (rideId, tx) => {
      if (!held) {
        held = true;
        await hold.wait();
      }
      return original(rideId, tx);
    });

    const markA = svc().markManual(a.userId, ride.id);
    await hold.reached;
    const markB = svc().markManual(b.userId, ride.id);
    // B упирается в незакоммиченную запись A в документ райда и повторяется (без механизма — завершается сразу)
    await untilBlocked(markB, () => retried({ mock: { calls: writes.mock.calls.slice(1) } })());
    hold.open();
    expect(await Promise.all([markA, markB])).toEqual([true, true]);

    expect(await pair(a.userId, b.userId)).toMatchObject({ rideCount: 1 });
    expect(await pair(b.userId, a.userId)).toMatchObject({ rideCount: 1 });
  });
});
