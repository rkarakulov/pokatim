import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { authed, createRide, rider, RIDES, ridesDb } from '../../../test/rides';
import { socialDb } from '../../../test/social';
import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';
import { RIDES_POLICY } from './rides.policy';

/**
 * Источник «Я иду» (K12, AC4, RC-6, RC-7): новая запись с `source` — одно событие `ride-joined` после коммита; повтор,
 * запись без `source`, квотная ветка и сбой журнала — без события и без отказа; тело строгое.
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

const joinUrl = (id: string) => `${RIDES}/${id}/join`;
const joinedEvents = () => socialDb(h).events.find({ type: 'ride-joined' }).toArray();
const isParticipant = async (rideId: string, userId: string) =>
  (await ridesDb(h).countDocuments({ _id: rideId, 'participants.userId': userId })) === 1;

describe('POST rides/:id/join — источник (K12)', () => {
  it('`{ source: ride_card }` — одно событие `ride-joined { source }`; повтор — по-прежнему одно', async () => {
    const org = await rider(h, 'org@example.by');
    const member = await rider(h, 'member@example.by');
    const ride = await createRide(h, org);
    const first = await authed(h, member, 'POST', joinUrl(ride.id), { source: 'ride_card' });
    expect(first.status).toBe(200);
    const again = await authed(h, member, 'POST', joinUrl(ride.id), { source: 'ride_card' });
    expect(again.status).toBe(200);
    const events = await joinedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: member.userId, props: { source: 'ride_card' } });
  });

  it('без `source` (`{}` и без тела) — 200, событий нет', async () => {
    const org = await rider(h, 'org@example.by');
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    const ride = await createRide(h, org);
    expect((await authed(h, a, 'POST', joinUrl(ride.id), {})).status).toBe(200);
    expect((await call(h, 'POST', joinUrl(ride.id), undefined, bearer(b.token))).status).toBe(200);
    expect(await isParticipant(ride.id, a.userId)).toBe(true);
    expect(await isParticipant(ride.id, b.userId)).toBe(true);
    expect(await joinedEvents()).toHaveLength(0);
  });

  it('незнакомый `source` и лишний ключ — 400 VALIDATION_FAILED', async () => {
    const org = await rider(h, 'org@example.by');
    const member = await rider(h, 'member@example.by');
    const ride = await createRide(h, org);
    for (const body of [{ source: 'feed' }, { source: 'ride_card', extra: 1 }]) {
      const res = await authed(h, member, 'POST', joinUrl(ride.id), body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await isParticipant(ride.id, member.userId)).toBe(false);
  });

  it('сбой журнала — 200, участник записан, лог `product_events.record_failed type=ride-joined`', async () => {
    const org = await rider(h, 'org@example.by');
    const member = await rider(h, 'member@example.by');
    const ride = await createRide(h, org);
    const events = h.app.get<ProductEvents>(PRODUCT_EVENTS, { strict: false });
    vi.spyOn(events, 'record').mockRejectedValueOnce(new Error('boom'));
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const res = await authed(h, member, 'POST', joinUrl(ride.id), { source: 'ride_card' });
    expect(res.status).toBe(200);
    expect(await isParticipant(ride.id, member.userId)).toBe(true);
    expect(await joinedEvents()).toHaveLength(0);
    expect(
      warnings.some((line) => line.includes('product_events.record_failed type=ride-joined')),
    ).toBe(true);
  });

  it('квотная ветка (уже участник при исчерпанной квоте) — 200 без события', async () => {
    const member = await rider(h, 'member@example.by');
    const perOrganizer = RIDES_POLICY.maxUpcomingOrganized;
    const rides = [];
    for (let index = 0; index < RIDES_POLICY.maxUpcomingJoined / perOrganizer; index += 1) {
      const org = await rider(h, `org${index}@example.by`);
      for (let n = 0; n < perOrganizer; n += 1) rides.push(await createRide(h, org));
    }
    for (const ride of rides) {
      expect((await authed(h, member, 'POST', joinUrl(ride.id), {})).status).toBe(200);
    }
    const [firstRide] = rides;
    if (!firstRide) throw new Error('нет райда');
    const res = await authed(h, member, 'POST', joinUrl(firstRide.id), { source: 'ride_card' });
    expect(res.status).toBe(200);
    expect(await joinedEvents()).toHaveLength(0);
  });
});
