import type {
  AttemptFailure,
  AttemptRejection,
  RouteRideCandidate,
  RouteRideRef,
} from '@pokatim/contracts';
import { boundsNear, type Bounds } from '@pokatim/tracks';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { ActivityRef, ActivitySource } from '../tracks';
import type {
  RouteRideDoc,
  RouteRideOrigin,
  RouteRideResult,
  RouteRideStatus,
} from './route-rides.collection';

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

/**
 * Автопроверка новой активности (route-rides-03, `[ASSUMPTION]` V1/V2/8.1 AC-4): только `cycling`/`unknown`, старт не
 * раньше 7 сут до приёма файла, ≤ 20 прогонов движка; скан «уже ездил» — ≤ 200 маршрутов, рамки — пачками по 25.
 */
export const ROUTE_RIDE_AUTO_POLICY = {
  recentDays: 7,
  maxRoutes: 20,
  riddenRoutesScan: 200,
  boundsBatch: 25,
  /** хранение плана события (TTL) — дольше ретраев и повторов outbox */
  planTtlDays: 30,
  /**
   * срок обработки события от приёма файла: без сохранённого плана позже — задача без плана и сверок (повтор после
   * TTL плана не строит новый, ревью pass 4); строго меньше `planTtlDays` (unit-тест)
   */
  processDeadlineMs: 7 * 86_400_000,
  sports: ['cycling', 'unknown'],
} as const;

/**
 * Таблица «Другие» маршрута каталога (route-rides-04, `[ASSUMPTION]` §8): скан — не больше 5000 райдеров маршрута,
 * до 3 лучших пройденных заездов райдера (удалён лучший — строка по следующему живому), живость активностей —
 * пачками по 1000 id (`ActivitySource.liveActivityIds`), лимит запросов — 300/ч на пользователя.
 */
export const ROUTE_RIDE_LEADERBOARD_POLICY = {
  scanRiders: 5000,
  topPerRider: 3,
  liveBatch: 1000,
  userLimit: { limit: 300, windowSec: 3600 },
} as const;

const DAY_MS = 86_400_000;

/** Активность годится для автопроверки (V1, 8.1 AC-3): спорт и старт `≥ uploadCreatedAt − 7 сут`. */
export function autoEligible(
  activity: Pick<ActivityRef, 'sport' | 'startedAt' | 'uploadCreatedAt'>,
): boolean {
  const sports: readonly string[] = ROUTE_RIDE_AUTO_POLICY.sports;
  return (
    sports.includes(activity.sport) &&
    activity.startedAt.getTime() >=
      activity.uploadCreatedAt.getTime() - ROUTE_RIDE_AUTO_POLICY.recentDays * DAY_MS
  );
}

/** Маршрут со своими заездами райдера (`RouteRidesRepository.ridesByRoute`, без заездов группы события). */
export interface RiddenRoute {
  routeId: string;
  rides: { activityId: string; startedAt: Date }[];
}

/** Заезд группы события по маршруту (`RouteRidesRepository.groupRides`); нет `origin` — ручной. */
export interface GroupRide {
  routeId: string;
  origin?: RouteRideOrigin;
}

/**
 * План автопроверки (V2, V4, 8.1 AC-4; ревью pass 1–2): `done` — маршруты с автозаездом группы (резервируют слоты
 * первыми, без прогона); `candidates` до видимости и рамки — (а) маршруты со своими живыми заездами по дате последнего
 * живого заезда ↓, затем (б) свои готовые маршруты в данном порядке (новые → старые) без повторов (а). Пропуск —
 * ручной заезд группы или живых заездов ≥ квоты. Заезды группы в `ridden` не входят (исключены до скана), поэтому
 * автозаезды не сдвигают порядок и окно скана: повтор события получает тот же план.
 */
export function autoPlan(input: {
  heads: ReadonlyMap<string, unknown>;
  ridden: readonly RiddenRoute[];
  own: readonly string[];
  group: readonly GroupRide[];
}): { done: string[]; candidates: string[] } {
  const manual = new Set(
    input.group.filter((ride) => (ride.origin ?? 'manual') !== 'auto').map((ride) => ride.routeId),
  );
  const done = [
    ...new Set(
      input.group
        .filter((ride) => ride.origin === 'auto' && !manual.has(ride.routeId))
        .map((ride) => ride.routeId),
    ),
  ].sort();
  const skip = new Set([...manual, ...done]);
  const ridden: { routeId: string; lastStartedAt: number }[] = [];
  for (const route of input.ridden) {
    const alive = route.rides.filter((ride) => input.heads.has(ride.activityId));
    if (alive.length >= ROUTE_RIDE_POLICY.maxPerRoute) skip.add(route.routeId);
    if (alive.length === 0 || skip.has(route.routeId)) continue;
    const lastStartedAt = Math.max(...alive.map((ride) => ride.startedAt.getTime()));
    ridden.push({ routeId: route.routeId, lastStartedAt });
  }
  ridden.sort((a, b) => b.lastStartedAt - a.lastStartedAt);
  const inRidden = new Set(ridden.map((route) => route.routeId));
  const own = [...new Set(input.own)].filter(
    (routeId) => !inRidden.has(routeId) && !skip.has(routeId),
  );
  return { done, candidates: [...ridden.map((route) => route.routeId), ...own] };
}

/** Первые `room` маршрутов по порядку, видимых (есть рамка) и с рамкой у рамки активности (600 м). */
export function nearRoutes(
  ordered: readonly string[],
  bounds: ReadonlyMap<string, Bounds>,
  activityBounds: Bounds,
  room: number,
): string[] {
  return ordered
    .filter((routeId) => {
      const routeBounds = bounds.get(routeId);
      return (
        routeBounds !== undefined &&
        boundsNear(activityBounds, routeBounds, ROUTE_RIDE_POLICY.boundsMarginM)
      );
    })
    .slice(0, Math.max(0, room));
}

/**
 * Основная активность группы сейчас (RC-7): основная — она сама, дубль — его основная; основную успели удалить или
 * сменить между чтениями — `null` (как неизвестная). Общая для ручного POST и автопроверки.
 */
export async function primaryOfGroup(
  activities: Pick<ActivitySource, 'activity'>,
  userId: string,
  activity: ActivityRef,
): Promise<ActivityRef | null> {
  if (activity.isPrimary) return activity;
  return activities.activity(userId, activity.primaryId);
}

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

/** Ключ ранжирования пройденного заезда: время сегмента, дата заезда, id заезда. */
export interface RideRankKey {
  elapsedSec: number;
  startedAt: Date;
  id: string;
}

/**
 * Порядок пройденных заездов (единственный компаратор): минимум времени; ничья — раньше заезд, затем меньший id.
 * Общий для «Моих заездов» (`bestOf`) и таблицы «Другие» (route-rides-04); тот же порядок у индекса `0049`.
 */
export function compareRides(a: RideRankKey, b: RideRankKey): number {
  return (
    a.elapsedSec - b.elapsedSec ||
    a.startedAt.getTime() - b.startedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const rankKeyOf = (ride: Passed): RideRankKey => ({
  elapsedSec: ride.segment.elapsedSec,
  startedAt: ride.activity.startedAt,
  id: ride._id,
});

/** Лучший пройденный: минимум времени; ничья — раньше заезд, затем меньший `_id` (`compareRides`). */
export function bestOf<T extends RouteRideFacts>(rides: readonly T[]): (T & Passed) | null {
  const passed = rides.filter(isPassed) as (T & Passed)[];
  passed.sort((a, b) => compareRides(rankKeyOf(a), rankKeyOf(b)));
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

/**
 * Документ нового заезда (общий для ручного `queued` и автопроверки `passed`, route-rides-03): снимок сводки
 * активности, коридор политики. Без `result` — `queued` (ручной POST, ревизия 1, попыток 0); с `result` — готовый
 * итог (автопроверка: ревизия 1, одна попытка).
 */
export function newRideDoc(input: {
  userId: string;
  routeId: string;
  activity: ActivityRef;
  origin: RouteRideOrigin;
  now: Date;
  result?: RouteRideResult;
}): RouteRideDoc {
  const { activity, now, result } = input;
  return {
    _id: uuidv7(),
    userId: input.userId,
    routeId: input.routeId,
    activityId: activity.id,
    activity: {
      startedAt: activity.startedAt,
      endedAt: activity.endedAt,
      source: activity.source,
      elapsedSec: activity.elapsedSec,
      distanceM: activity.distanceM,
    },
    origin: input.origin,
    corridorWidthM: ROUTE_RIDE_POLICY.corridorWidthM,
    checkRevision: 1,
    checkAttempts: result ? 1 : 0,
    status: 'queued',
    reasons: [],
    failure: null,
    segment: null,
    touchedCorridor: null,
    engineVersion: null,
    trackMap: null,
    checkedAt: null,
    ...result,
    createdAt: now,
    updatedAt: now,
  };
}
