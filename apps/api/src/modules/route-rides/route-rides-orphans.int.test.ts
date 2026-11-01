import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { daysAgo } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { catalogCorridorRoute, ownCorridorRoute, routeRidesDb } from '../../../test/route-rides';
import { seedRouteRide } from '../../../test/route-ride-seed';
import { rider } from '../../../test/results';
import { routesDb } from '../../../test/routes';
import { tracks } from '../../../test/tracks';
import {
  ROUTE_RIDES_ORPHANS_CURSOR_KEY,
  ROUTE_RIDES_ORPHANS_JOB,
  RouteRidesMaintenanceProcessor,
} from './route-rides-maintenance.processor';
import { ROUTE_RIDE_ORPHANS_POLICY } from './route-rides.policy';

/**
 * Уборщик сирот (route-rides-08): `RouteRidesMaintenanceProcessor` напрямую на worker стенда; заезды — прямой вставкой
 * поверх живых активностей, сироты — удалением активности или маршрута из коллекций.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
const policy = ROUTE_RIDE_ORPHANS_POLICY as { batchSize: number; maxBatches: number };
const defaults = { ...policy };
afterEach(() => {
  Object.assign(policy, defaults);
});
afterAll(async () => {
  await h.close();
});

const TEAM = '01890a5d-ac96-774b-bcce-b30209900002';
const sweeper = () => h.worker.get(RouteRidesMaintenanceProcessor);
const job = (name: string) => ({ name, data: {} }) as unknown as Job;
const remaining = async () =>
  (
    await routeRidesDb(h)
      .rides.find({}, { projection: { _id: 1 } })
      .toArray()
  )
    .map((doc) => doc._id)
    .sort();

describe('уборщик сирот route-rides (route-rides-08)', () => {
  it('удалённая активность и удалённый маршрут — удалены; живые, снятый с публикации и дубль группы — остаются; повтор — 0', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const catalog = await catalogCorridorRoute(h, TEAM);
    const unpublished = await catalogCorridorRoute(h, TEAM);
    const own = await ownCorridorRoute(h, me.userId);

    const live = await seedRouteRide(h, me.userId, catalog, 900, daysAgo(h, 5));
    const otherLive = await seedRouteRide(h, other.userId, catalog, 950, daysAgo(h, 5));
    const goneActivity = await seedRouteRide(h, me.userId, catalog, 1000, daysAgo(h, 4));
    await seedRouteRide(h, me.userId, own, 1100, daysAgo(h, 3));
    const hidden = await seedRouteRide(h, me.userId, unpublished, 1200, daysAgo(h, 2));
    const duplicate = await seedRouteRide(h, me.userId, catalog, 1300, daysAgo(h, 1));

    await tracks(h).activities.deleteOne({ _id: goneActivity.activityId });
    await routesDb(h).routes.deleteOne({ _id: own });
    await routesDb(h).routes.updateOne({ _id: unpublished }, { $set: { catalog: null } });
    // дубль жив — заезд виден на чтении и не сирота
    await tracks(h).activities.updateOne(
      { _id: duplicate.activityId },
      { $set: { duplicateOf: live.activityId } },
    );

    expect(await sweeper().process(job(ROUTE_RIDES_ORPHANS_JOB))).toEqual({
      scanned: 6,
      deletedActivity: 1,
      deletedRoute: 1,
      batches: 1,
      more: false,
    });
    expect(await remaining()).toEqual(
      [live.rideId, otherLive.rideId, hidden.rideId, duplicate.rideId].sort(),
    );

    expect(await sweeper().sweep()).toMatchObject({
      scanned: 4,
      deletedActivity: 0,
      deletedRoute: 0,
    });
    await expect(sweeper().process(job('other'))).rejects.toThrow('unknown job');
  });

  it('пачки и предел за прогон: хвост — следующим прогоном с курсора Redis; конец скана — курсор снят', async () => {
    const me = await rider(h);
    const routeId = await catalogCorridorRoute(h, TEAM);
    const rides = [];
    for (let i = 0; i < 5; i += 1) {
      rides.push(await seedRouteRide(h, me.userId, routeId, 900 + i, daysAgo(h, 5 - i)));
    }
    rides.sort((a, b) => a.rideId.localeCompare(b.rideId));
    // сироты — первый и последний по `_id`
    await tracks(h).activities.deleteMany({
      _id: { $in: [rides[0]!.activityId, rides[4]!.activityId] },
    });
    Object.assign(policy, { batchSize: 2, maxBatches: 2 });

    expect(await sweeper().sweep()).toEqual({
      scanned: 4,
      deletedActivity: 1,
      deletedRoute: 0,
      batches: 2,
      more: true,
    });
    expect(await h.redis.get(ROUTE_RIDES_ORPHANS_CURSOR_KEY)).toBe(rides[3]!.rideId);

    expect(await sweeper().sweep()).toEqual({
      scanned: 1,
      deletedActivity: 1,
      deletedRoute: 0,
      batches: 1,
      more: false,
    });
    expect(await h.redis.get(ROUTE_RIDES_ORPHANS_CURSOR_KEY)).toBeNull();
    expect(await remaining()).toEqual(
      rides
        .slice(1, 4)
        .map((ride) => ride.rideId)
        .sort(),
    );
  });
});
