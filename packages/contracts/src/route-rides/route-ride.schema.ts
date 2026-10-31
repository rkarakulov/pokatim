import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { RiderRowLink } from '../profile/rider-avatar.schema.ts';
import { LonLat } from '../races/race-route.schema.ts';
import {
  ATTEMPT_FAILURES,
  ATTEMPT_REJECTIONS,
  ATTEMPT_TRACK_MARKS,
  MY_ATTEMPT_TRACK_MAX_POINTS,
  MY_ATTEMPT_TRACK_MAX_RUNS,
  TrackMapRun,
} from '../results/results.schema.ts';
import { LocalDate } from '../time.ts';
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
/** Происхождение заезда (route-rides-03): ручная проверка / автопроверка новой активности. Только в конец. */
export const ROUTE_RIDE_ORIGINS = ['manual', 'auto'] as const;
export type RouteRideOrigin = (typeof ROUTE_RIDE_ORIGINS)[number];
/** Статус участка маршрута (route-rides-05): пройден / не пройден. Только в конец. */
export const ROUTE_RIDE_SECTION_STATUSES = ['passed', 'not_passed'] as const;
export type RouteRideSectionStatus = (typeof ROUTE_RIDE_SECTION_STATUSES)[number];
/** Предел участков заезда (= `ROUTE_SECTION_POLICY.maxSections` разбиения; равенство сторожит unit-тест API). */
export const ROUTE_RIDE_SECTIONS_MAX = 30;
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
 * Участок маршрута в заезде (route-rides-05): метры по маршруту от старта (не координаты), время — только у
 * `passed`; лучший и дельта — среди своих заездов с тем же разбиением (считает сервер). `bestElapsedSec` — лучшее
 * время участка среди своих (есть и у `not_passed`); `deltaToBestSec` — только у `passed` (0 — этот лучший).
 */
export const RouteRideSection = z.object({
  fromM: int,
  toM: int,
  status: tolerantEnum(ROUTE_RIDE_SECTION_STATUSES),
  elapsedSec: int.nullable(),
  isBest: z.boolean(),
  bestElapsedSec: int.nullable(),
  deltaToBestSec: int.nullable(),
});
export type RouteRideSection = z.infer<typeof RouteRideSection>;

/**
 * Заезд по маршруту: статус, вердикт, время и сравнение со своими пройденными заездами (дельты — знаковые целые,
 * отрицательная — быстрее; только у `passed`). `activityId` — своя основная активность группы сейчас («Проверить
 * снова»; старый API — `null`), `origin` — происхождение (route-rides-03; старый API — `manual`), `sections` —
 * участки маршрута (route-rides-05; нет участков и старый API — `[]`).
 */
export const RouteRideDetail = z.object({
  id: Uuid,
  route: RouteRideRouteRef,
  activityId: Uuid.nullable().default(null),
  origin: tolerantEnum(ROUTE_RIDE_ORIGINS).default('manual'),
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
  sections: z.array(RouteRideSection).max(ROUTE_RIDE_SECTIONS_MAX).default([]),
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

/** Строк таблицы «Другие» за запрос (route-rides-04): по умолчанию 10, не больше 100; курсора нет. */
export const ROUTE_RIDE_LEADERBOARD_DEFAULT = 10;
export const ROUTE_RIDE_LEADERBOARD_MAX = 100;

/** `GET /v1/routes/:routeId/rides/leaderboard` — лишние ключи — 400. */
export const RouteRideLeaderboardQuery = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ROUTE_RIDE_LEADERBOARD_MAX)
    .default(ROUTE_RIDE_LEADERBOARD_DEFAULT),
});
export type RouteRideLeaderboardQuery = z.infer<typeof RouteRideLeaderboardQuery>;

/**
 * Строка таблицы «Другие» (O3): лучший живой пройденный заезд райдера с согласием; места уникальные (1…), без «=N».
 * Имя, ссылка и фото — по P1/R4 (иначе `null` → «Участник»). `rideId` — только у своей строки («Вы»).
 */
export const RouteRideLeaderboardRow = z.object({
  place: int,
  elapsedSec: int,
  /** день заезда по Минску, без времени суток */
  rideDate: LocalDate,
  riderName: z.string().nullable().default(null),
  ...RiderRowLink,
  rideId: Uuid.nullable().default(null),
});
export type RouteRideLeaderboardRow = z.infer<typeof RouteRideLeaderboardRow>;

/** Своя строка (O4): видна себе всегда, пока есть живой пройденный заезд; место — среди строк таблицы и себя. */
export const RouteRideLeaderboardMe = z.object({
  place: int,
  elapsedSec: int,
  rideDate: LocalDate,
  rideId: Uuid,
});
export type RouteRideLeaderboardMe = z.infer<typeof RouteRideLeaderboardMe>;

/**
 * Таблица «Другие» маршрута каталога (route-rides-04, `no-store`): первые `limit` строк, `total` — всего строк
 * (райдеры с согласием + вы), `me` — своя строка или `null`, `shared` — включён ли у вас показ заездов.
 */
export const RouteRideLeaderboard = z.object({
  rows: z.array(RouteRideLeaderboardRow).max(ROUTE_RIDE_LEADERBOARD_MAX),
  total: int,
  me: RouteRideLeaderboardMe.nullable(),
  shared: z.boolean(),
});
export type RouteRideLeaderboard = z.infer<typeof RouteRideLeaderboard>;
