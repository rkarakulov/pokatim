import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { daysAgo, pastRide } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { createRide, hideInDb, join, leave, rider, ridesDb } from '../../../test/rides';
import { RIDER_RIDES, RIDER_RIDES_MAX_ROWS, type RiderRides } from './rider-rides.port';
import { RidesRepository } from './rides.repository';

/** Порт `RiderRides` (achievements): прошедшие райды райдера по условиям R8 (как история профиля). */
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

const port = () => h.app.get<RiderRides>(RIDER_RIDES, { strict: false });

describe('RiderRides.pastOf (achievements)', () => {
  it('прошедшие с «Иду» и организацией, порядок ↑; будущие, отменённые, скрытые, покинутые, чужие — нет', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const third = await rider(h, 'third@example.com');

    const organized = await pastRide(h, me, [other], 2, 'Мой');
    const joined = await pastRide(h, other, [me], 6, 'С «Иду»');
    const alone = await pastRide(h, me, [], 4, 'Один');
    const cancelled = await pastRide(h, other, [me], 3);
    await ridesDb(h).updateOne({ _id: cancelled }, { $set: { status: 'cancelled' } });
    const hidden = await pastRide(h, third, [me], 5);
    await hideInDb(h, hidden);
    await pastRide(h, third, [], 7);
    const left = await createRide(h, third);
    await join(h, me, left.id);
    await leave(h, me, left.id);
    await ridesDb(h).updateOne({ _id: left.id }, { $set: { startsAt: daysAgo(h, 1) } });
    const future = await createRide(h, other);
    await join(h, me, future.id);

    expect(await port().pastOf(me.userId)).toEqual([
      {
        rideId: joined,
        title: 'С «Иду»',
        startsAt: daysAgo(h, 6),
        organizer: false,
        goingCount: 2,
      },
      { rideId: alone, title: 'Один', startsAt: daysAgo(h, 4), organizer: true, goingCount: 1 },
      { rideId: organized, title: 'Мой', startsAt: daysAgo(h, 2), organizer: true, goingCount: 2 },
    ]);
  });

  it('равные даты — порядок по id ↑', async () => {
    const me = await rider(h, 'me@example.com');
    const a = await pastRide(h, me, [], 3);
    const b = await pastRide(h, me, [], 3);
    expect((await port().pastOf(me.userId)).map((fact) => fact.rideId)).toEqual([a, b].sort());
  });

  it('предел строк — лог `achievements.rides_truncated` без отказа', async () => {
    const me = await rider(h, 'me@example.com');
    await pastRide(h, me, [], 3);
    const repository = h.app.get(RidesRepository, { strict: false });
    const original = repository.pastFactsOf.bind(repository);
    vi.spyOn(repository, 'pastFactsOf').mockImplementation(async (userId, now, limit) => {
      expect(limit).toBe(RIDER_RIDES_MAX_ROWS);
      const rows = await original(userId, now, limit);
      return Array.from({ length: limit }, () => rows[0]!);
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await port().pastOf(me.userId)).toHaveLength(RIDER_RIDES_MAX_ROWS);
    expect(warn.mock.calls.map((args) => String(args[0]))).toContain(
      `achievements.rides_truncated uid=${me.userId} limit=${RIDER_RIDES_MAX_ROWS}`,
    );
  });
});
