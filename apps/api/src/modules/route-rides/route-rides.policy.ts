import type {
  AttemptFailure,
  AttemptRejection,
  RouteRideCandidate,
  RouteRideRef,
} from '@pokatim/contracts';
import { boundsNear, type Bounds } from '@pokatim/tracks';

import type { ActivityRef } from '../tracks';
import type { RouteRideDoc, RouteRideStatus } from './route-rides.collection';

/**
 * Правила заезда по маршруту (route-rides-01, `[ASSUMPTION]` §8): коридор и окно сверки, кандидаты, квота, лимит,
 * зависшие проверки (8.1 RC-5 — «ленивый» `failed` при чтении).
 */
export const ROUTE_RIDE_POLICY = {
  corridorWidthM: 50,
  windowMarginMs: 60_000,
  candidatesDays: 365,
  candidatesScan: 200,
  candidatesLimit: 30,
  boundsMarginM: 600,
  maxPerRoute: 100,
  userLimit: { limit: 30, windowSec: 3600 },
  stuckQueuedMs: 2 * 3_600_000,
  stuckCheckingMs: 15 * 60_000,
} as const;

/** Поля заезда, нужные правилам (список читается без `trackMap`). */
export type RouteRideFacts = Omit<RouteRideDoc, 'trackMap'>;

/** Окно сверки — время самого заезда ± 1 мин (8.1 RC-4: `outside_window` не возникает). */
export function matchWindowOf(activity: { startedAt: Date; endedAt: Date }) {
  return {
    startsAt: new Date(activity.startedAt.getTime() - ROUTE_RIDE_POLICY.windowMarginMs),
    closesAt: new Date(activity.endedAt.getTime() + ROUTE_RIDE_POLICY.windowMarginMs),
  };
}

/** Границы зависания (`updatedAt` раньше — зависший): `queued` > 2 ч, `checking` > 15 мин. */
export function stuckBounds(now: Date): { queuedBefore: Date; checkingBefore: Date } {
  return {
    queuedBefore: new Date(now.getTime() - ROUTE_RIDE_POLICY.stuckQueuedMs),
    checkingBefore: new Date(now.getTime() - ROUTE_RIDE_POLICY.stuckCheckingMs),
  };
}

/** Статус наружу: зависшие `queued` > 2 ч и `checking` > 15 мин (строго больше) — `failed: error` (RC-5). */
export function effectiveStatus(
  ride: Pick<RouteRideDoc, 'status' | 'failure' | 'updatedAt'>,
  now: Date,
): { status: RouteRideStatus; failure: AttemptFailure | null } {
  const { queuedBefore, checkingBefore } = stuckBounds(now);
  const before =
    ride.status === 'queued' ? queuedBefore : ride.status === 'checking' ? checkingBefore : null;
  if (before && ride.updatedAt < before) return { status: 'failed', failure: 'error' };
  return { status: ride.status, failure: ride.failure };
}

/** Вердикт движка → статус заезда: `counted` — «Пройден», `rejected` — «Не пройден» с причинами. */
export function verdictOf(match: {
  verdict: 'counted' | 'rejected';
  reasons: readonly AttemptRejection[];
}): { status: 'passed' | 'not_passed'; reasons: AttemptRejection[] } {
  return match.verdict === 'counted'
    ? { status: 'passed', reasons: [] }
    : { status: 'not_passed', reasons: [...match.reasons] };
}

type Passed = RouteRideFacts & { segment: NonNullable<RouteRideFacts['segment']> };

const isPassed = (ride: RouteRideFacts): ride is Passed =>
  ride.status === 'passed' && ride.segment !== null;

const byIdAsc = (a: RouteRideFacts, b: RouteRideFacts) =>
  a._id < b._id ? -1 : a._id > b._id ? 1 : 0;

/** Лучший пройденный: минимум времени; ничья — раньше заезд, затем меньший `_id`. */
export function bestOf<T extends RouteRideFacts>(rides: readonly T[]): (T & Passed) | null {
  const passed = rides.filter(isPassed) as (T & Passed)[];
  passed.sort(
    (a, b) =>
      a.segment.elapsedSec - b.segment.elapsedSec ||
      a.activity.startedAt.getTime() - b.activity.startedAt.getTime() ||
      byIdAsc(a, b),
  );
  return passed[0] ?? null;
}

/** Предыдущий пройденный: последний по дате заезда строго раньше этого; ничья по времени — меньший `_id`. */
export function previousOf<T extends RouteRideFacts>(
  rides: readonly T[],
  ride: RouteRideFacts,
): (T & Passed) | null {
  const earlier = (rides.filter(isPassed) as (T & Passed)[]).filter(
    (other) => other.activity.startedAt.getTime() < ride.activity.startedAt.getTime(),
  );
  earlier.sort(
    (a, b) => b.activity.startedAt.getTime() - a.activity.startedAt.getTime() || byIdAsc(a, b),
  );
  return earlier[0] ?? null;
}

const refOf = (ride: Passed): RouteRideRef => ({
  id: ride._id,
  elapsedSec: ride.segment.elapsedSec,
  rideStartedAt: ride.activity.startedAt.toISOString(),
});

/** Сравнение со своими пройденными (RC-13): `best` — всегда, если есть; дельты — только у `passed`. */
export function comparisonOf(rides: readonly RouteRideFacts[], ride: RouteRideFacts) {
  const best = bestOf(rides);
  const previous = previousOf(rides, ride);
  const own = isPassed(ride) ? ride.segment.elapsedSec : null;
  return {
    best: best ? refOf(best) : null,
    isBest: best !== null && best._id === ride._id,
    deltaToBestSec: own !== null && best ? own - best.segment.elapsedSec : null,
    previous: previous ? refOf(previous) : null,
    deltaToPreviousSec: own !== null && previous ? own - previous.segment.elapsedSec : null,
  };
}

/** Сводка: все видимые заезды, пройденные, лучший. */
export function summaryOf(rides: readonly RouteRideFacts[]) {
  const best = bestOf(rides);
  return {
    count: rides.length,
    passedCount: rides.filter(isPassed).length,
    best: best ? refOf(best) : null,
  };
}

/** Новые по дате заезда сверху, затем `_id` по убыванию. */
export function sortRides<T extends RouteRideFacts>(rides: readonly T[]): T[] {
  return [...rides].sort(
    (a, b) => b.activity.startedAt.getTime() - a.activity.startedAt.getTime() || byIdAsc(b, a),
  );
}

/**
 * Существующий заезд группы дублей (RC-3): его активность сейчас живая и в группе с основной `primaryId`
 * (`heads` — `ActivitySource.liveActivities`).
 */
export function findExisting<T extends Pick<RouteRideDoc, 'activityId'>>(
  rides: readonly T[],
  heads: ReadonlyMap<string, { primaryId: string }>,
  primaryId: string,
): T | undefined {
  return rides.find((ride) => heads.get(ride.activityId)?.primaryId === primaryId);
}

/**
 * Кандидаты «выбрать свой заезд» (RC-6): основные активности (новые сверху) без `cycling_indoor`, рамка — у рамки
 * маршрута (`boundsNear`, 600 м), не больше 30; `rideId` — уже проверенный заезд этой группы по маршруту.
 */
export function candidateRows(
  activities: readonly ActivityRef[],
  routeBounds: Bounds,
  rides: readonly Pick<RouteRideDoc, '_id' | 'activityId'>[],
  heads: ReadonlyMap<string, { primaryId: string }>,
): RouteRideCandidate[] {
  return activities
    .filter(
      (activity) =>
        activity.sport !== 'cycling_indoor' &&
        boundsNear(activity.bounds, routeBounds, ROUTE_RIDE_POLICY.boundsMarginM),
    )
    .slice(0, ROUTE_RIDE_POLICY.candidatesLimit)
    .map((activity) => ({
      activityId: activity.id,
      startedAt: activity.startedAt.toISOString(),
      source: activity.source,
      elapsedSec: Math.round(activity.elapsedSec),
      distanceM: Math.round(activity.distanceM),
      rideId: findExisting(rides, heads, activity.id)?._id ?? null,
    }));
}
