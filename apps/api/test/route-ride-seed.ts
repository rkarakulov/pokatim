import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { RouteRideDoc } from '../src/modules/route-rides/route-rides.collection';
import { seedActivity } from './achievements';
import type { Harness } from './harness';
import { routeRidesDb } from './route-rides';

/** Заезд маршрута прямой вставкой поверх новой живой активности (`seedActivity`); время сегмента — `elapsedSec`. */
export async function seedRouteRide(
  h: Harness,
  userId: string,
  routeId: string,
  elapsedSec: number,
  startedAt: Date,
  overrides: Partial<RouteRideDoc> = {},
): Promise<{ rideId: string; activityId: string }> {
  const activityId = await seedActivity(h, userId, startedAt);
  const rideId = uuidv7();
  const status = overrides.status ?? 'passed';
  await routeRidesDb(h).rides.insertOne({
    _id: rideId,
    userId: userId,
    routeId,
    activityId,
    activity: {
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      source: 'upload',
      elapsedSec: 3600,
      distanceM: 8000,
    },
    origin: 'manual',
    corridorWidthM: 50,
    status,
    checkRevision: 1,
    checkAttempts: 1,
    reasons: status === 'not_passed' ? ['no_finish'] : [],
    failure: status === 'failed' ? 'error' : null,
    segment:
      status === 'passed'
        ? {
            startedAt,
            finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
            elapsedSec,
            distanceM: 8000,
            offCorridorM: 0,
            offCorridorShare: 0,
            maxExcursionM: 0,
            coverage: 1,
          }
        : null,
    touchedCorridor: status === 'passed' ? true : null,
    engineVersion: 1,
    trackMap: null,
    createdAt: h.clock.now(),
    updatedAt: h.clock.now(),
    checkedAt: h.clock.now(),
    ...overrides,
  });
  return { rideId, activityId };
}
