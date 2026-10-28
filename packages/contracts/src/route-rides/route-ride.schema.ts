import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { LonLat } from '../races/race-route.schema.ts';
import {
  ATTEMPT_FAILURES,
  ATTEMPT_REJECTIONS,
  ATTEMPT_TRACK_MARKS,
  MY_ATTEMPT_TRACK_MAX_POINTS,
  MY_ATTEMPT_TRACK_MAX_RUNS,
  TrackMapRun,
} from '../results/results.schema.ts';
import { TRACK_SOURCES } from '../tracks/track-upload.schema.ts';

/*
 * Заезд по маршруту вне гонки (route-rides-01): сверка своего заезда с маршрутом каталога или своим готовым маршрутом,
 * личная история и сравнение со своими прошлыми заездами. Вердикт, время и сравнение считает только сервер; клиент
 * присылает намерение («этот заезд»). Ответы — `tolerantEnum`; справочники — только в конец.
 */

/** Статус заезда: в очереди / проверяется / пройден / не пройден (причина) / провал проверки (код). Только в конец. */
export const ROUTE_RIDE_STATUSES = [
  'queued',
  'checking',
  'passed',
  'not_passed',
  'failed',
] as const;
export type RouteRideStatus = (typeof ROUTE_RIDE_STATUSES)[number];
/** Квота заездов райдера на маршрут (и предел строк списка). */
export const ROUTE_RIDE_MAX_PER_ROUTE = 100;
/** Предел кандидатов «выбрать свой заезд». */
export const ROUTE_RIDE_CANDIDATES_MAX = 30;

const iso = z.iso.datetime();
const int = z.number().int();

/** `POST /v1/routes/:routeId/rides`: свой заезд (`activityId`) или загрузка (`uploadId`). Ровно одно поле. */
export const RouteRideRequest = z.union([
  z.strictObject({ activityId: Uuid }),
  z.strictObject({ uploadId: Uuid }),
]);
export type RouteRideRequest = z.infer<typeof RouteRideRequest>;

/** Маршрут заезда, видимый райдеру (каталог или свой готовый). */
export const RouteRideRouteRef = z.object({ id: Uuid, title: z.string(), distanceM: int });
export type RouteRideRouteRef = z.infer<typeof RouteRideRouteRef>;

/** Сводка своего заезда (снимок активности): без координат и датчиков. */
export const RouteRideActivity = z.object({
  startedAt: iso,
  source: tolerantEnum(TRACK_SOURCES),
  elapsedSec: int,
  distanceM: int,
});
export type RouteRideActivity = z.infer<typeof RouteRideActivity>;

/** Ссылка на пройденный заезд для сравнения (лучший, предыдущий). */
export const RouteRideRef = z.object({ id: Uuid, elapsedSec: int, rideStartedAt: iso });
export type RouteRideRef = z.infer<typeof RouteRideRef>;

/** Строка истории заездов по маршруту. */
export const RouteRideRow = z.object({
  id: Uuid,
  status: tolerantEnum(ROUTE_RIDE_STATUSES),
  /** первая причина; только `not_passed` */
  reason: tolerantEnum(ATTEMPT_REJECTIONS).nullable(),
  /** только `passed` */
  elapsedSec: int.nullable(),
  isBest: z.boolean(),
  activity: RouteRideActivity,
  createdAt: iso,
});
export type RouteRideRow = z.infer<typeof RouteRideRow>;

/** `GET /v1/routes/:routeId/rides`: свои заезды по маршруту, новые по дате заезда сверху, без курсора. */
export const RouteRidePage = z.object({
  route: RouteRideRouteRef,
  summary: z.object({ count: int, passedCount: int, best: RouteRideRef.nullable() }),
  items: z.array(RouteRideRow).max(ROUTE_RIDE_MAX_PER_ROUTE),
});
export type RouteRidePage = z.infer<typeof RouteRidePage>;

/** Своя основная активность для выбора; `rideId` — уже проверенный заезд этой группы дублей по маршруту. */
export const RouteRideCandidate = z.object({
  activityId: Uuid,
  startedAt: iso,
  source: tolerantEnum(TRACK_SOURCES),
  elapsedSec: int,
  distanceM: int,
  rideId: Uuid.nullable(),
});
export type RouteRideCandidate = z.infer<typeof RouteRideCandidate>;

/** `GET /v1/routes/:routeId/rides/candidates`: последние 365 дней, рамка у маршрута, новые сверху. */
export const RouteRideCandidates = z.object({
  items: z.array(RouteRideCandidate).max(ROUTE_RIDE_CANDIDATES_MAX),
});
export type RouteRideCandidates = z.infer<typeof RouteRideCandidates>;

/**
 * Заезд по маршруту: статус, вердикт, время и сравнение со своими пройденными заездами (дельты — знаковые целые,
 * отрицательная — быстрее; только у `passed`).
 */
export const RouteRideDetail = z.object({
  id: Uuid,
  route: RouteRideRouteRef,
  status: tolerantEnum(ROUTE_RIDE_STATUSES),
  /** первая причина; только `not_passed` */
  reason: tolerantEnum(ATTEMPT_REJECTIONS).nullable(),
  /** только `failed` */
  failure: tolerantEnum(ATTEMPT_FAILURES).nullable(),
  /** только `passed` */
  elapsedSec: int.nullable(),
  routeDistanceM: int.nullable(),
  activity: RouteRideActivity,
  comparison: z.object({
    best: RouteRideRef.nullable(),
    isBest: z.boolean(),
    deltaToBestSec: int.nullable(),
    previous: RouteRideRef.nullable(),
    deltaToPreviousSec: int.nullable(),
  }),
  createdAt: iso,
  checkedAt: iso.nullable(),
});
export type RouteRideDetail = z.infer<typeof RouteRideDetail>;

/**
 * `GET /v1/routes/:routeId/rides/:rideId/track` — как `MyAttemptTrack` (maps-02): своя линия заезда (≤ 1000 точек) и
 * разметка сегмента и схода; `pending`/`unavailable` — `segment: null`, `offRuns: []`.
 */
export const RouteRideTrack = z.object({
  rideId: Uuid,
  line: z.array(LonLat).min(2).max(MY_ATTEMPT_TRACK_MAX_POINTS),
  segment: TrackMapRun.nullable(),
  offRuns: z.array(TrackMapRun).max(MY_ATTEMPT_TRACK_MAX_RUNS),
  marks: tolerantEnum(ATTEMPT_TRACK_MARKS),
});
export type RouteRideTrack = z.infer<typeof RouteRideTrack>;
