import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import {
  createRide,
  hideInDb,
  join,
  rider,
  ridesDb,
  seedTeamRoute,
  type Rider,
} from '../../../test/rides';
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
