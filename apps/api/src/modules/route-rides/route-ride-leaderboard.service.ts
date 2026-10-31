import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  RateLimitedDetails,
  RouteRideLeaderboard,
  RouteRideLeaderboardQuery,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { chunks } from './rider-route-rides';
import { firstAlive, type LeaderboardEntry, rankLeaderboard } from './route-ride-leaderboard';
import { bestOf, ROUTE_RIDE_LEADERBOARD_POLICY } from './route-rides.policy';
import { RouteRidesRepository } from './route-rides.repository';

/**
 * Таблица «Другие» маршрута каталога (route-rides-04, O1–O5): лимит запросов → маршрут каталога (`catalogRoute`, без
 * кэша; иначе `404`) → лучшие заезды райдеров маршрута (агрегат, ≤ 5000) → согласие сейчас (`routeRideRiders`, без
 * кэша) → живые активности (`liveActivityIds`) → своя строка тем же путём, что «Мои заезды» (RC-2) → места. Чужие
 * модули — только через порты. Логи — id маршрута и счётчики, без имён, дат заездов и `userId` чужих.
 */
@Injectable()
export class RouteRideLeaderboardService {
  private readonly logger = new Logger(RouteRideLeaderboardService.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async table(
    userId: string,
    routeId: string,
    query: RouteRideLeaderboardQuery,
  ): Promise<RouteRideLeaderboard> {
    await this.limit(userId);
    if (!(await this.routes.catalogRoute(routeId))) throw domainError('NOT_FOUND', 404);

    const { scanRiders, topPerRider, liveBatch } = ROUTE_RIDE_LEADERBOARD_POLICY;
    const scanned = await this.repository.leaderboardTop(routeId, scanRiders, topPerRider);
    if (scanned.length >= scanRiders) {
      this.logger.warn(`route_rides.leaderboard_truncated route=${routeId}`);
    }
    const riders = scanned.filter((row) => row.userId !== userId);
    const { shares, cards } = await this.names.routeRideRiders([
      ...riders.map((row) => row.userId),
      userId,
    ]);
    const sharing = riders.filter((row) => shares.has(row.userId));
    const live = new Set<string>();
    const activityIds = [...new Set(sharing.flatMap((row) => row.top.map((r) => r.activityId)))];
    for (const ids of chunks(activityIds, liveBatch)) {
      for (const id of await this.activities.liveActivityIds(ids)) live.add(id);
    }
    const others = sharing.flatMap((row): LeaderboardEntry[] => {
      const ride = firstAlive(row.top, live);
      return ride
        ? [
            {
              userId: row.userId,
              rideId: ride.id,
              elapsedSec: ride.elapsedSec,
              startedAt: ride.startedAt,
            },
          ]
        : [];
    });

    return rankLeaderboard({
      others,
      me: await this.own(userId, routeId),
      cards,
      limit: query.limit,
      shared: shares.has(userId),
    });
  }

  /** Своя строка (RC-2): свои заезды маршрута → живые активности → `bestOf` (ровно `summary.best` «Моих заездов»). */
  private async own(userId: string, routeId: string): Promise<LeaderboardEntry | null> {
    const rides = await this.repository.listOwn(userId, routeId);
    const heads = await this.activities.liveActivities(
      userId,
      rides.map((ride) => ride.activityId),
    );
    const best = bestOf(rides.filter((ride) => heads.has(ride.activityId)));
    return best
      ? {
          userId,
          rideId: best._id,
          elapsedSec: best.segment.elapsedSec,
          startedAt: best.activity.startedAt,
        }
      : null;
  }

  private async limit(userId: string): Promise<void> {
    const result = await this.rateLimiter.consume(
      `route-rides-leaderboard:${userId}`,
      ROUTE_RIDE_LEADERBOARD_POLICY.userLimit,
      this.clock.now(),
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}
