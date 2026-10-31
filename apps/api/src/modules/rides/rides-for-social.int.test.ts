import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import {
  createRide,
  hideInDb,
  join,
  rider,
  ridesDb,
  seedTeamRoute,
  startsIn,
  type Rider,
} from '../../../test/rides';
import { seedRiderRoute } from '../../../test/routes';
import { RIDES_FOR_SOCIAL, type RidesForSocial } from './index';

/**
 * Порт `rides` для «Свои» (ADR-0027): организатор первым среди участников; фаза — `ridePhase` (скрытый и отменённый
 * отдаются); точная точка старта — только у райда на маршруте каталога; неизвестный райд — `null`.
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

const port = () => h.worker.get<RidesForSocial>(RIDES_FOR_SOCIAL, { strict: false });

describe('RidesForSocial.rideFacts', () => {
  it('будущий райд: фаза upcoming, организатор первым, затем «Иду» по порядку; без маршрута — preciseStart null', async () => {
    const b = await rider(h, 'b@example.by');
    const c = await rider(h, 'c@example.by');
    const ride = await createRide(h, organizer);
    expect((await join(h, c, ride.id)).status).toBe(200);
    expect((await join(h, b, ride.id)).status).toBe(200);

    expect(await port().rideFacts(ride.id, h.clock.now())).toEqual({
      rideId: ride.id,
      phase: 'upcoming',
      startsAt: new Date(ride.startsAt),
      organizerUserId: organizer.userId,
      participantIds: [organizer.userId, c.userId, b.userId],
      preciseStart: null,
    });
  });

  it('после старта — past; отменённый — cancelled; скрытый — hidden', async () => {
    const ride = await createRide(h, organizer);
    const now = new Date(h.clock.now().getTime() + 2 * DAY);
    expect((await port().rideFacts(ride.id, now))?.phase).toBe('past');

    await hideInDb(h, ride.id);
    expect((await port().rideFacts(ride.id, now))?.phase).toBe('hidden');

    await ridesDb(h).updateOne({ _id: ride.id }, { $set: { status: 'cancelled' } });
    expect((await port().rideFacts(ride.id, now))?.phase).toBe('cancelled');
  });

  it('маршрут каталога — точка старта маршрута (startPrecise)', async () => {
    const routeId = await seedTeamRoute(h, [27.61, 53.97]);
    const ride = await createRide(h, organizer, { routeId });
    expect((await port().rideFacts(ride.id, h.clock.now()))?.preciseStart).toEqual([27.61, 53.97]);
  });

  it('неизвестный райд — null', async () => {
    expect(await port().rideFacts(uuidv7(), h.clock.now())).toBeNull();
  });
});

describe('RidesForSocial.nextRideCard («Идёт», P3)', () => {
  it('ранний будущий из участия и организации; отменённый, скрытый, прошедший пропущены; карточка без участников', async () => {
    const target = await rider(h, 'target@example.by');
    const viewer = await rider(h, 'viewer@example.by');
    // раньше всех: отменённый и скрытый (райдер — участник), и прошедший
    const cancelled = await createRide(h, organizer, { startsAt: startsIn(h, 2 * HOUR) });
    const hidden = await createRide(h, organizer, { startsAt: startsIn(h, 3 * HOUR) });
    const past = await createRide(h, organizer, { startsAt: startsIn(h, HOUR) });
    for (const ride of [cancelled, hidden, past]) {
      expect((await join(h, target, ride.id)).status).toBe(200);
    }
    await ridesDb(h).updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });
    await hideInDb(h, hidden.id);
    const early = await createRide(h, organizer, { startsAt: startsIn(h, DAY) });
    expect((await join(h, target, early.id)).status).toBe(200);
    const own = await createRide(h, target, { startsAt: startsIn(h, 2 * DAY) });
    const now = new Date(h.clock.now().getTime() + 90 * 60_000);

    const card = await port().nextRideCard(target.userId, viewer.userId, now);
    expect(card).toMatchObject({
      id: early.id,
      phase: 'upcoming',
      goingCount: 2,
      viewer: { role: 'none', canJoin: true, canLeave: false, canManage: false },
    });
    expect(card).not.toHaveProperty('participants');
    expect(card).not.toHaveProperty('organizerUserId');

    // после раннего — свой (организатор — первый участник)
    const later = new Date(new Date(early.startsAt).getTime() + 1);
    expect((await port().nextRideCard(target.userId, viewer.userId, later))?.id).toBe(own.id);
  });

  it('роль зрителя: none / participant / organizer', async () => {
    const target = await rider(h, 'target@example.by');
    const viewer = await rider(h, 'viewer@example.by');
    const ride = await createRide(h, organizer);
    expect((await join(h, target, ride.id)).status).toBe(200);
    const now = h.clock.now();
    expect((await port().nextRideCard(target.userId, viewer.userId, now))?.viewer.role).toBe(
      'none',
    );
    expect((await join(h, viewer, ride.id)).status).toBe(200);
    expect(await port().nextRideCard(target.userId, viewer.userId, now)).toMatchObject({
      viewer: { role: 'participant', canJoin: false, canLeave: true },
    });
    expect((await port().nextRideCard(target.userId, organizer.userId, now))?.viewer.role).toBe(
      'organizer',
    );
  });

  it('чужой непубличный маршрут — route: null; организатору — свой маршрут', async () => {
    const target = await rider(h, 'target@example.by');
    const viewer = await rider(h, 'viewer@example.by');
    const routeId = await seedRiderRoute(h, target.userId);
    await createRide(h, target, { routeId });
    const now = h.clock.now();
    expect(await port().nextRideCard(target.userId, viewer.userId, now)).toMatchObject({
      route: null,
      start: null,
    });
    expect((await port().nextRideCard(target.userId, target.userId, now))?.route).toMatchObject({
      id: routeId,
      access: 'private',
    });
  });

  it('нет будущих райдов — null', async () => {
    const target = await rider(h, 'target@example.by');
    expect(await port().nextRideCard(target.userId, organizer.userId, h.clock.now())).toBeNull();
  });
});
