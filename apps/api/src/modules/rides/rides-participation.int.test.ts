import { RideView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { eventsOfType } from '../../../test/notifications';
import {
  authed,
  createRide,
  join,
  leave,
  RIDES,
  rider,
  ridesDb,
  type Rider,
} from '../../../test/rides';
import { RIDES_POLICY } from './rides.policy';

/**
 * Участие (AC2, AC3, AC-T1, AC-T2): «Я иду» / «Не иду» — одна атомарная операция над документом райда,
 * идемпотентно; полный — `RIDE_FULL`; после старта, отменённый — `RIDE_INVALID_STATE`; организатор «Не иду» — 409;
 * квота отметок; гонка на последнее место — ровно одна успешна.
 */
let h: Harness;
let organizer: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
});
afterAll(async () => {
  await h.close();
});

/** Инвариант документа: `goingCount === participants.length ≤ limit`, без повторов. */
async function expectConsistent(id: string) {
  const doc = await ridesDb(h).findOne({ _id: id });
  if (!doc) throw new Error('нет райда');
  const ids = doc.participants.map((p) => p.userId);
  expect(doc.goingCount).toBe(ids.length);
  expect(new Set(ids).size).toBe(ids.length);
  expect(doc.goingCount).toBeLessThanOrEqual(doc.limit ?? 100);
  return doc;
}

describe('«Я иду» / «Не иду»', () => {
  it('запись и снятие: роль, счётчик, права; повтор — 200 без двойного счёта', async () => {
    const ride = await createRide(h, organizer, { limit: 12 });
    const a = await rider(h, 'a@example.by');
    const joined = RideView.parse((await join(h, a, ride.id)).body);
    expect(joined.viewer).toEqual({
      role: 'participant',
      canJoin: false,
      canLeave: true,
      canManage: false,
      reported: false,
      canReport: true,
    });
    expect(joined.ride.goingCount).toBe(2);
    expect(joined.ride).not.toHaveProperty('version');

    const again = await join(h, a, ride.id);
    expect(again.status).toBe(200);
    expect(RideView.parse(again.body).ride.goingCount).toBe(2);

    const left = RideView.parse((await leave(h, a, ride.id)).body);
    expect(left.viewer.role).toBe('none');
    expect(left.viewer.canJoin).toBe(true);
    expect(left.ride.goingCount).toBe(1);
    const leftAgain = await leave(h, a, ride.id);
    expect(leftAgain.status).toBe(200);
    expect(RideView.parse(leftAgain.body).ride.goingCount).toBe(1);
    await expectConsistent(ride.id);
  });

  it('полный — 409 RIDE_FULL; снятая отметка освобождает место (AC3)', async () => {
    const ride = await createRide(h, organizer, { limit: 2 });
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    expect(RideView.parse((await join(h, a, ride.id)).body).ride.full).toBe(true);
    const full = await join(h, b, ride.id);
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ code: 'RIDE_FULL' });
    const me = RideView.parse((await authed(h, b, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(me.viewer.canJoin).toBe(false);
    await leave(h, a, ride.id);
    expect((await join(h, b, ride.id)).status).toBe(200);
    await expectConsistent(ride.id);
  });

  it('организатор: «Я иду» — идемпотентно, «Не иду» — 409 RIDE_INVALID_STATE', async () => {
    const ride = await createRide(h, organizer);
    const self = await join(h, organizer, ride.id);
    expect(self.status).toBe(200);
    expect(RideView.parse(self.body).ride.goingCount).toBe(1);
    const leaveSelf = await leave(h, organizer, ride.id);
    expect(leaveSelf.status).toBe(409);
    expect(leaveSelf.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
  });

  it('после старта и отменённый — 409 RIDE_INVALID_STATE; неизвестный — 404', async () => {
    const a = await rider(h, 'a@example.by');
    const past = await createRide(h, organizer);
    await join(h, a, past.id);
    await ridesDb(h).updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );
    const b = await rider(h, 'b@example.by');
    expect((await join(h, b, past.id)).body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    expect((await leave(h, a, past.id)).body).toMatchObject({ code: 'RIDE_INVALID_STATE' });

    const cancelled = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, { reason: 'weather' });
    expect((await join(h, b, cancelled.id)).body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    // не участник отменённого — идемпотентный успех «Не иду»
    expect((await leave(h, b, cancelled.id)).status).toBe(200);

    expect((await join(h, b, '01890a5d-ac96-774b-bcce-b302099a8057')).status).toBe(404);
    expect((await join(h, b, 'not-a-uuid')).status).toBe(400);
  });

  it('без входа — 401', async () => {
    const ride = await createRide(h, organizer);
    const guest = await h.app.inject({
      method: 'POST',
      url: `${RIDES}/${ride.id}/join`,
      payload: {},
    });
    expect(guest.statusCode).toBe(401);
  });

  it('квота: 21-я будущая отметка — 409 RIDE_QUOTA_EXCEEDED; повтор уже сделанной — 200', async () => {
    const a = await rider(h, 'a@example.by');
    const others = [organizer, await rider(h, 'o2@example.by'), await rider(h, 'o3@example.by')];
    others.push(await rider(h, 'o4@example.by'), await rider(h, 'o5@example.by'));
    const rides = [];
    for (const owner of others) {
      for (let i = 0; i < RIDES_POLICY.maxUpcomingOrganized; i++) {
        rides.push(await createRide(h, owner));
      }
    }
    for (const ride of rides.slice(0, RIDES_POLICY.maxUpcomingJoined)) {
      expect((await join(h, a, ride.id)).status).toBe(200);
    }
    const over = await join(h, a, rides[RIDES_POLICY.maxUpcomingJoined]!.id);
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({
      code: 'RIDE_QUOTA_EXCEEDED',
      details: { quota: 'joined', limit: 20 },
    });
    expect((await join(h, a, rides[0]!.id)).status).toBe(200);
  });

  it('лимит частоты rides-rsvp (join + leave): 429 + Retry-After', async () => {
    const ride = await createRide(h, organizer);
    const a = await rider(h, 'a@example.by');
    for (let i = 0; i < RIDES_POLICY.rsvpLimit.limit; i++) {
      const res = i % 2 === 0 ? await join(h, a, ride.id) : await leave(h, a, ride.id);
      expect(res.status).toBe(200);
    }
    const limited = await join(h, a, ride.id);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('гонка на последнее место (AC-T1)', () => {
  it('K параллельных «Я иду» на одно место — ровно одна успешна, остальные RIDE_FULL', async () => {
    const ride = await createRide(h, organizer, { limit: 3 });
    await join(h, await rider(h, 'first@example.by'), ride.id);
    const contenders: Rider[] = [];
    for (let i = 0; i < 6; i++) contenders.push(await rider(h, `c${i}@example.by`));
    const results = await Promise.all(contenders.map((who) => join(h, who, ride.id)));
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(5);
    for (const res of results.filter((r) => r.status === 409)) {
      expect(res.body).toMatchObject({ code: 'RIDE_FULL' });
    }
    const doc = await expectConsistent(ride.id);
    expect(doc.goingCount).toBe(3);
  });

  it('параллельные «Я иду» одного райдера — одна отметка; join/leave вперемешку держат инвариант', async () => {
    const ride = await createRide(h, organizer, { limit: 10 });
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    await Promise.all([join(h, a, ride.id), join(h, a, ride.id), join(h, a, ride.id)]);
    expect((await expectConsistent(ride.id)).goingCount).toBe(2);
    await Promise.all([
      leave(h, a, ride.id),
      join(h, b, ride.id),
      join(h, a, ride.id),
      leave(h, b, ride.id),
      join(h, b, ride.id),
    ]);
    await expectConsistent(ride.id);
  });
});

describe('событие rides.participant-joined (notifications, ADR-0017)', () => {
  it('новый участник — событие { rideId }; повтор, организатор, полный и «Не иду» — без события', async () => {
    const ride = await createRide(h, organizer, { limit: 2 });
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    expect((await join(h, a, ride.id)).status).toBe(200);
    expect((await join(h, a, ride.id)).status).toBe(200);
    expect((await join(h, organizer, ride.id)).status).toBe(200);
    expect((await join(h, b, ride.id)).status).toBe(409);
    expect((await leave(h, a, ride.id)).status).toBe(200);
    const events = await eventsOfType(h, 'rides.participant-joined');
    expect(events.map((event) => event.payload)).toEqual([{ rideId: ride.id }]);
  });

  it('параллельные «Я иду» на последнее место — одно событие на одну успешную запись', async () => {
    const ride = await createRide(h, organizer, { limit: 2 });
    const riders: Rider[] = [];
    for (let i = 0; i < 5; i++) riders.push(await rider(h, `p${i}@example.by`));
    const results = await Promise.all(riders.map((who) => join(h, who, ride.id)));
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    await expectConsistent(ride.id);
    expect(await eventsOfType(h, 'rides.participant-joined')).toHaveLength(1);
  });
});
