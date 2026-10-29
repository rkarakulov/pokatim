import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { routesDb, seedRiderRoute } from '../../../test/routes';
import {
  authed,
  createRide,
  hideInDb,
  RIDES,
  rider,
  ridesDb,
  seedTeamRoute,
  type Rider,
} from '../../../test/rides';
import { RIDES_FOR_SHARING, type RidesForSharing } from './index';

/**
 * Порт `rides` для OG-картинки (og-images, D7/D9): опубликованный райд любой фазы → публичные факты; скрытый,
 * отменённый, неизвестный — `null`; маршрут — только из каталога. Keyset изменений — только опубликованные.
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

const port = () => h.app.get<RidesForSharing>(RIDES_FOR_SHARING);
const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute));

describe('ogFacts', () => {
  it('опубликованный (и прошедший) — факты без организатора; маршрут каталога → routeId', async () => {
    const routeId = await seedTeamRoute(h);
    const ride = await createRide(h, organizer, { routeId, organizerName: 'Иван Организатор' });
    const facts = await port().ogFacts(ride.id);
    expect(facts).toMatchObject({
      rideId: ride.id,
      title: 'Кофе-райд на море',
      place: 'Парк Победы, у входа',
      distanceKm: 42,
      paceMinKmh: 22,
      paceMaxKmh: 24,
      routeId,
    });
    expect(JSON.stringify(facts)).not.toContain('Организатор');
    expect(JSON.stringify(facts)).not.toContain(organizer.userId);
    h.clock.advance(3 * DAY);
    expect(await port().ogFacts(ride.id)).toMatchObject({ rideId: ride.id });
  });

  it('свой (private) маршрут и маршрут, снятый с каталога, — routeId: null (AC4)', async () => {
    const own = await seedRiderRoute(h, organizer.userId);
    const privateRide = await createRide(h, organizer, { routeId: own });
    expect(await port().ogFacts(privateRide.id)).toMatchObject({ routeId: null });
    const team = await seedTeamRoute(h);
    const ride = await createRide(h, organizer, { routeId: team });
    await routesDb(h).routes.updateOne({ _id: team }, { $set: { catalog: null } });
    expect(await port().ogFacts(ride.id)).toMatchObject({ routeId: null });
  });

  it('скрытый, отменённый, неизвестный — null', async () => {
    const hidden = await createRide(h, organizer);
    await hideInDb(h, hidden.id);
    const cancelled = await createRide(h, organizer);
    const res = await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, {
      reason: 'weather',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const id of [hidden.id, cancelled.id, uuidv7()]) {
      expect(await port().ogFacts(id)).toBeNull();
    }
  });
});

describe('ogChanged', () => {
  it('порядок (updatedAt, _id), курсор на равных updatedAt, limit; скрытые и отменённые — нет', async () => {
    const rides = await Promise.all([1, 2, 3, 4].map(() => createRide(h, organizer)));
    const [a, b, c] = rides
      .slice(0, 3)
      .map((ride) => ride.id)
      .sort();
    await ridesDb(h).updateOne({ _id: c! }, { $set: { updatedAt: at(1) } });
    await ridesDb(h).updateOne({ _id: a! }, { $set: { updatedAt: at(2) } });
    await ridesDb(h).updateOne({ _id: b! }, { $set: { updatedAt: at(2) } });
    await ridesDb(h).updateOne(
      { _id: rides[3]!.id },
      { $set: { status: 'hidden', updatedAt: at(3) } },
    );
    expect(await port().ogChanged(null, 10)).toEqual([
      { id: c, updatedAt: at(1) },
      { id: a, updatedAt: at(2) },
      { id: b, updatedAt: at(2) },
    ]);
    expect(await port().ogChanged(null, 2)).toHaveLength(2);
    expect(await port().ogChanged({ at: at(2), id: a! }, 10)).toEqual([
      { id: b, updatedAt: at(2) },
    ]);
  });
});
