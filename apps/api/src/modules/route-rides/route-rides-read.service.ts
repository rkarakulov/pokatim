import { Inject, Injectable } from '@nestjs/common';
import type {
  RouteRideCandidates,
  RouteRideDetail,
  RouteRidePage,
  RouteRideRow,
  RouteRideTrack,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { ROUTE_RIDE_ROUTES, type RideableRoute, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { RouteRideDoc } from './route-rides.collection';
import {
  bestOf,
  candidateRows,
  comparisonOf,
  effectiveStatus,
  ROUTE_RIDE_POLICY,
  type RouteRideFacts,
  sectionsOf,
  sortRides,
  summaryOf,
} from './route-rides.policy';
import { RouteRidesRepository } from './route-rides.repository';

const notFound = () => domainError('NOT_FOUND', 404);
const DAY_MS = 86_400_000;

/** Заезды маршрута, видимые райдеру сейчас, с их статусом наружу (зависшие — `failed: error`). */
interface Visible {
  route: RideableRoute;
  rides: RouteRideFacts[];
  /** живые активности заездов → основная группы сейчас */
  heads: Map<string, { primaryId: string }>;
}

const routeRef = (route: RideableRoute) => ({
  id: route.id,
  title: route.title,
  distanceM: Math.round(route.distanceM),
});

const activityOf = (ride: RouteRideFacts) => ({
  startedAt: ride.activity.startedAt.toISOString(),
  source: ride.activity.source,
  elapsedSec: Math.round(ride.activity.elapsedSec),
  distanceM: Math.round(ride.activity.distanceM),
});

/**
 * Чтения заездов по маршруту (route-rides-01): каждое — видимость маршрута (`RouteRideRoutes.rideable`, без кэша;
 * не виден — `404`), свои заезды маршрута → только с живыми активностями (`ActivitySource.liveActivities`, 8.1 RC-1)
 * → правила `route-rides.policy`. Ответы — явным списком полей: без `userId`, id активности (кроме кандидатов и
 * своей основной в детали), `trackMap`, `engineVersion`, координат вне `/track`.
 */
@Injectable()
export class RouteRidesReadService {
  constructor(
    private readonly repository: RouteRidesRepository,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Маршрут, видимый райдеру сейчас; иначе один `404`. */
  async route(routeId: string, userId: string): Promise<RideableRoute> {
    const route = await this.routes.rideable(routeId, userId);
    if (!route) throw notFound();
    return route;
  }

  async list(userId: string, routeId: string): Promise<RouteRidePage> {
    const { route, rides } = await this.visible(userId, routeId);
    const best = bestOf(rides);
    return {
      route: routeRef(route),
      summary: summaryOf(rides),
      items: sortRides(rides)
        .slice(0, ROUTE_RIDE_POLICY.maxPerRoute)
        .map((ride): RouteRideRow => {
          const fields = this.verdict(ride);
          return {
            id: ride._id,
            status: fields.status,
            reason: fields.reason,
            elapsedSec: fields.elapsedSec,
            isBest: best?._id === ride._id,
            activity: activityOf(ride),
            createdAt: ride.createdAt.toISOString(),
          };
        }),
    };
  }

  async detail(userId: string, routeId: string, rideId: string): Promise<RouteRideDetail> {
    const { route, rides, heads } = await this.visible(userId, routeId);
    const ride = rides.find((item) => item._id === rideId);
    if (!ride) throw notFound();
    const fields = this.verdict(ride);
    return {
      id: ride._id,
      route: routeRef(route),
      // основная своей группы сейчас (мог стать дублем после позднего импорта), не хранимый id (8.1 AC-11)
      activityId: heads.get(ride.activityId)?.primaryId ?? ride.activityId,
      origin: ride.origin ?? 'manual',
      status: fields.status,
      reason: fields.reason,
      failure: fields.failure,
      elapsedSec: fields.elapsedSec,
      routeDistanceM: fields.routeDistanceM,
      activity: activityOf(ride),
      comparison: comparisonOf(rides, ride),
      createdAt: ride.createdAt.toISOString(),
      checkedAt: ride.checkedAt?.toISOString() ?? null,
      // участки — только у итога движка; у очереди, проверки и провала (в т. ч. зависших) — нет
      sections:
        fields.status === 'passed' || fields.status === 'not_passed' ? sectionsOf(rides, ride) : [],
    };
  }

  /** Своя линия заезда и разметка схода (как `myAttemptTrack`, maps-02). */
  async track(userId: string, routeId: string, rideId: string): Promise<RouteRideTrack> {
    await this.route(routeId, userId);
    const ride = await this.repository.findOwn(userId, routeId, rideId);
    if (!ride) throw notFound();
    const live = await this.activities.liveActivities(userId, [ride.activityId]);
    if (!live.has(ride.activityId)) throw notFound();
    const line = await this.activities.trackLine(userId, ride.activityId);
    if (!line || line.length < 2) throw notFound();
    const { status } = effectiveStatus(ride, this.clock.now());
    const pending = status === 'queued' || status === 'checking';
    const trackMap = ride.trackMap;
    const ready = !pending && trackMap !== null && trackMap.linePoints === line.length;
    return {
      rideId: ride._id,
      line,
      segment:
        ready && trackMap.segment ? { from: trackMap.segment[0], to: trackMap.segment[1] } : null,
      offRuns: ready ? trackMap.offRuns.map(([from, to]) => ({ from, to })) : [],
      marks: pending ? 'pending' : ready ? 'ready' : 'unavailable',
    };
  }

  /** Свои основные активности за 365 дней у рамки маршрута (8.1 RC-6). */
  async candidates(userId: string, routeId: string): Promise<RouteRideCandidates> {
    const route = await this.route(routeId, userId);
    const now = this.clock.now();
    const activities = await this.activities.listInRange(
      userId,
      new Date(now.getTime() - ROUTE_RIDE_POLICY.candidatesDays * DAY_MS),
      now,
      ROUTE_RIDE_POLICY.candidatesScan,
    );
    const rides = await this.repository.listOwn(userId, routeId);
    const heads = await this.activities.liveActivities(
      userId,
      rides.map((ride) => ride.activityId),
    );
    return { items: candidateRows(activities, route.bounds, rides, heads) };
  }

  /** Маршрут виден → свои заезды с живыми активностями; статус наружу — с учётом зависших. */
  private async visible(userId: string, routeId: string): Promise<Visible> {
    const route = await this.route(routeId, userId);
    const now = this.clock.now();
    const own = await this.repository.listOwn(userId, routeId);
    const heads = await this.activities.liveActivities(
      userId,
      own.map((ride) => ride.activityId),
    );
    const rides = own
      .filter((ride) => heads.has(ride.activityId))
      .map((ride) => ({ ...ride, ...effectiveStatus(ride, now) }));
    return { route, rides, heads };
  }

  /** Вердикт наружу: причина — только `not_passed`, провал — только `failed`, время — только `passed`. */
  private verdict(ride: Pick<RouteRideDoc, 'status' | 'reasons' | 'failure' | 'segment'>) {
    const segment = ride.status === 'passed' ? ride.segment : null;
    return {
      status: ride.status,
      reason: ride.status === 'not_passed' ? (ride.reasons[0] ?? null) : null,
      failure: ride.status === 'failed' ? (ride.failure ?? 'error') : null,
      elapsedSec: segment?.elapsedSec ?? null,
      routeDistanceM: segment?.distanceM ?? null,
    };
  }
}
