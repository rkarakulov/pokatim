import { Inject, Injectable, Logger } from '@nestjs/common';

import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import {
  RIDER_ROUTE_RIDES_MAX_ROWS,
  type RiderRouteRideFact,
  type RiderRouteRides,
} from './rider-route-rides.port';
import { RouteRidesRepository } from './route-rides.repository';

/** Пачки портов: `liveActivities` — ≤ 200 id, `rideableTitles` — ≤ 500 id за вызов. */
const ACTIVITIES_CHUNK = 200;
const ROUTES_CHUNK = 500;

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

/**
 * Реализация порта `RiderRouteRides` (achievements): видимость заезда — та же, что у «Заездов по маршруту»
 * (`RouteRidesReadService.visible`): живая активность (`ActivitySource.liveActivities`) и маршрут, видимый райдеру
 * сейчас (`RouteRideRoutes.rideableTitles`, без кэша). Только `passed` — зависшие статусы не важны.
 */
@Injectable()
export class RiderRouteRidesService implements RiderRouteRides {
  private readonly logger = new Logger(RiderRouteRidesService.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
  ) {}

  async passedOf(userId: string): Promise<RiderRouteRideFact[]> {
    const rides = await this.repository.passedOf(userId, RIDER_ROUTE_RIDES_MAX_ROWS);
    if (rides.length === RIDER_ROUTE_RIDES_MAX_ROWS) {
      this.logger.warn(
        `achievements.route_rides_truncated uid=${userId} limit=${RIDER_ROUTE_RIDES_MAX_ROWS}`,
      );
    }
    if (rides.length === 0) return [];
    const live = new Set<string>();
    for (const ids of chunks(
      [...new Set(rides.map((ride) => ride.activityId))],
      ACTIVITIES_CHUNK,
    )) {
      for (const id of (await this.activities.liveActivities(userId, ids)).keys()) live.add(id);
    }
    const alive = rides.filter((ride) => live.has(ride.activityId));
    const titles = new Map<string, string>();
    for (const ids of chunks([...new Set(alive.map((ride) => ride.routeId))], ROUTES_CHUNK)) {
      for (const [id, title] of await this.routes.rideableTitles(ids, userId))
        titles.set(id, title);
    }
    return alive.flatMap((ride) => {
      const routeTitle = titles.get(ride.routeId);
      return routeTitle === undefined
        ? []
        : [{ routeId: ride.routeId, routeTitle, startedAt: ride.activity.startedAt }];
    });
  }
}
