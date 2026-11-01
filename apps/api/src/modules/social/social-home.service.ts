import { Inject, Injectable } from '@nestjs/common';
import { SOCIAL_HOME_ROWS_MAX, type SocialHome, type SocialHomeRider } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { consumeUserLimit } from '../../user-limit';
import { RESULTS_FOR_SOCIAL, type ResultsForSocial } from '../results';
import { RIDES_FOR_SOCIAL, type RidesForSocial } from '../rides';
import { ROUTES_FOR_SOCIAL, type RoutesForSocial } from '../routes';
import { ConnectionsRepository } from './connections.repository';
import { SocialConnectionsService } from './connections.service';
import { homeRiderOf, pickHomeRows, resultRowOf, rideRowOf, routeRowOf } from './social-home.view';
import { SOCIAL_POLICY } from './social.policy';

/**
 * Секция «Свои» на Главной (K7, P7, ADR-0027 п. 3): «свои» зрителя — исходящие не убранные связи с публичным профилем
 * (`listOf`, K3, ≤ `homeConnectionsMax`); райды — только при взаимной связи (RC-P7-1a, как «Идёт» K6), результаты и
 * маршруты — по исходящей. Данные чужих модулей — порты `RIDES_FOR_SOCIAL`, `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`;
 * отбор и сборка — чистые функции `social-home.view.ts`. `userId` в ответ не идёт.
 */
@Injectable()
export class SocialHomeService {
  constructor(
    private readonly connections: SocialConnectionsService,
    private readonly repository: ConnectionsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    @Inject(RESULTS_FOR_SOCIAL) private readonly results: ResultsForSocial,
    @Inject(ROUTES_FOR_SOCIAL) private readonly routes: RoutesForSocial,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async homeOf(viewerId: string): Promise<SocialHome> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `social-home:${viewerId}`,
      SOCIAL_POLICY.homeLimit,
      now,
    );
    const friends = new Map<string, SocialHomeRider>();
    for (const row of await this.connections.listOf(viewerId)) {
      if (friends.size >= SOCIAL_POLICY.homeConnectionsMax) break;
      const rider = homeRiderOf(row.card);
      if (rider) friends.set(row.otherId, rider);
    }
    if (friends.size === 0) return { items: [] };
    const ids = [...friends.keys()];
    const since = new Date(now.getTime() - SOCIAL_POLICY.homeWindowMs);
    const until = new Date(now.getTime() + SOCIAL_POLICY.homeWindowMs);
    // райды — только «свои», у которых зритель тоже в «своих» (RC-P7-1a)
    const owners = new Set(await this.repository.ownerIdsOf(viewerId));
    const mutual = new Map([...friends].filter(([userId]) => owners.has(userId)));
    const [rides, results, routes] = await Promise.all([
      mutual.size === 0
        ? Promise.resolve([])
        : this.rides.upcomingWithRiders(
            [...mutual.keys()],
            viewerId,
            now,
            until,
            SOCIAL_HOME_ROWS_MAX,
          ),
      this.results.recentResults(ids, viewerId, since, SOCIAL_HOME_ROWS_MAX),
      this.routes.recentByAuthors(ids, since, SOCIAL_HOME_ROWS_MAX),
    ]);
    return {
      items: pickHomeRows({
        ride: rides.flatMap((ride) => rideRowOf(ride, mutual) ?? []),
        result: results.flatMap((result) => resultRowOf(result, friends) ?? []),
        route: routes.flatMap((route) => routeRowOf(route, friends) ?? []),
      }),
    };
  }
}
