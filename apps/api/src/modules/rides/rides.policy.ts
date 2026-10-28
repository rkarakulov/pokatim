import {
  CITY_CENTERS,
  type CityCode,
  type FieldErrorCode,
  RIDE_MAX_PARTICIPANTS,
  RIDE_START_MAX_AHEAD_DAYS,
  RIDE_START_MIN_LEAD_MIN,
  type RidePhase,
  type RideViewer,
} from '@pokatim/contracts';

import type { RideRouteRef } from '../routes';
import type { GeoPoint, RideDoc } from './rides.collection';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Правила кофе-райдов (Q8 [ASSUMPTION]): окно времени старта, квоты будущих райдов и отметок, лимиты частоты
 * (`RateLimiter` базы, ключ — `uid`).
 */
export const RIDES_POLICY = {
  startMinLeadMs: RIDE_START_MIN_LEAD_MIN * MINUTE_MS,
  startMaxAheadMs: RIDE_START_MAX_AHEAD_DAYS * DAY_MS,
  maxUpcomingOrganized: 5,
  maxUpcomingJoined: 20,
  createLimit: { limit: 10, windowSec: 24 * 3600 },
  manageLimit: { limit: 30, windowSec: 3600 },
  rsvpLimit: { limit: 60, windowSec: 3600 },
  /** Жалобы (05b): 20 в сутки на пользователя (`[ASSUMPTION]`), ключ `rides-report:<uid>`. */
  reportLimit: { limit: 20, windowSec: 24 * 3600 },
  /** «Рядом» и карта ленты (05c, 8.3 п. 4): 60 в минуту, ключ `rides-near:<uid>` — ограничение перебора центров. */
  nearLimit: { limit: 60, windowSec: 60 },
} as const;

type PhaseInput = Pick<RideDoc, 'status' | 'startsAt'>;

/** Фаза не хранится: `hidden` (статус) → `cancelled` (статус) → `past` (`now ≥ startsAt`) → `upcoming`. */
export function ridePhase(ride: PhaseInput, now: Date): RidePhase {
  if (ride.status === 'hidden') return 'hidden';
  if (ride.status === 'cancelled') return 'cancelled';
  return now.getTime() >= ride.startsAt.getTime() ? 'past' : 'upcoming';
}

/** Мест нет: идущих не меньше лимита (без лимита — технический потолок 100). */
export function rideFull(ride: Pick<RideDoc, 'goingCount' | 'limit'>): boolean {
  return ride.goingCount >= (ride.limit ?? RIDE_MAX_PARTICIPANTS);
}

/** Зритель: вошедший (`userId`, участник ли он по `$elemMatch` своего id) или гость (`null`). */
export interface RideViewerInput {
  userId: string;
  participant: boolean;
}

/**
 * Права зрителя — источник для клиента (он только показывает). Записаться — будущий опубликованный райд с местами,
 * не участник; снять отметку — участник, не организатор; управлять — организатор будущего опубликованного.
 * Пожаловаться (05b) — вошедший не-организатор, ещё не жаловался, райд не скрыт (фаза любая: текст прошедшего тоже
 * бывает оскорбительным). Скрытый — всё `false`.
 */
export function rideViewer(
  ride: PhaseInput & Pick<RideDoc, 'organizerUserId' | 'goingCount' | 'limit'>,
  viewer: RideViewerInput | null,
  now: Date,
  reported = false,
): RideViewer {
  const upcoming = ridePhase(ride, now) === 'upcoming';
  const role =
    viewer === null
      ? 'none'
      : viewer.userId === ride.organizerUserId
        ? 'organizer'
        : viewer.participant
          ? 'participant'
          : 'none';
  return {
    role,
    canJoin: upcoming && role === 'none' && !rideFull(ride),
    canLeave: upcoming && role === 'participant',
    canManage: upcoming && role === 'organizer',
    reported,
    canReport: viewer !== null && role !== 'organizer' && !reported && ride.status !== 'hidden',
  };
}

/** Виден ли райд зрителю: скрытый — только организатору; гостю (`null`) — нет. */
export function visibleTo(
  ride: Pick<RideDoc, 'status' | 'organizerUserId'>,
  userId: string | null,
): boolean {
  return ride.status !== 'hidden' || (userId !== null && ride.organizerUserId === userId);
}

export type ModerationAction = 'hide' | 'restore' | 'dismiss';

/**
 * Переходы модерации (05b): «Скрыть» — из `published`/`cancelled`; «Вернуть» — только `hidden` (в
 * `hiddenFromStatus`); «Отклонить жалобы» — есть открытые и не `hidden`. Иначе — `RIDE_INVALID_STATE`.
 */
export function moderationTransition(
  ride: Pick<RideDoc, 'status' | 'openReportCount'>,
  action: ModerationAction,
): 'ok' | 'RIDE_INVALID_STATE' {
  const allowed =
    action === 'hide'
      ? ride.status !== 'hidden'
      : action === 'restore'
        ? ride.status === 'hidden'
        : ride.status !== 'hidden' && ride.openReportCount > 0;
  return allowed ? 'ok' : 'RIDE_INVALID_STATE';
}

/**
 * Окно времени старта при создании и при изменении `startsAt`: не раньше `now + 30 мин`, не дальше `now + 60 дней`.
 * Неизменённое при правке `startsAt` не проверяется (вызывающий решает).
 */
export function validateStartsAt(
  startsAt: Date,
  now: Date,
): Extract<FieldErrorCode, 'RIDE_START_IN_PAST' | 'RIDE_START_TOO_FAR'> | null {
  const at = startsAt.getTime();
  if (at < now.getTime() + RIDES_POLICY.startMinLeadMs) return 'RIDE_START_IN_PAST';
  if (at > now.getTime() + RIDES_POLICY.startMaxAheadMs) return 'RIDE_START_TOO_FAR';
  return null;
}

/**
 * Точка «Рядом» райда (05c): маршрут виден публично — его старт (`startPrecise`); иначе (нет маршрута или свой
 * непубличный — его старт не раскрывается) — центр города. Координаты — копия (справочник не меняется).
 */
export function rideStartOf(
  route: RideRouteRef | null,
  cityCode: CityCode,
): { geo: GeoPoint; startPrecise: boolean } {
  const precise = route?.access === 'public';
  const [lon, lat] = precise ? route.start : CITY_CENTERS[cityCode];
  return { geo: { type: 'Point', coordinates: [lon, lat] }, startPrecise: precise };
}

const samePoint = (a: GeoPoint, b: GeoPoint) =>
  a.coordinates[0] === b.coordinates[0] && a.coordinates[1] === b.coordinates[1];

/**
 * Правка меняет время, город или место старта — или точную точку старта на другую точную (05c, RC-4: прикрепить
 * маршрут к райду без точки или снять его — уточнение, не перенос). «Перенос» (`rescheduledAt`) — только если при
 * этом идут другие участники: это условие проверяет сама запись по счётчику документа в момент операции
 * (репозиторий), а не прочитанный заранее `goingCount` — первый участник мог записаться между чтением и правкой.
 * Документ до `0030_rides_geo` (без `geo`) — без точной точки.
 */
export function changesStart(
  ride: Pick<RideDoc, 'startsAt' | 'cityCode' | 'place'> &
    Partial<Pick<RideDoc, 'geo' | 'startPrecise'>>,
  patch: {
    startsAt?: Date;
    cityCode?: RideDoc['cityCode'];
    place?: string;
    geo?: GeoPoint;
    startPrecise?: boolean;
  },
): boolean {
  return (
    (patch.startsAt !== undefined && patch.startsAt.getTime() !== ride.startsAt.getTime()) ||
    (patch.cityCode !== undefined && patch.cityCode !== ride.cityCode) ||
    (patch.place !== undefined && patch.place !== ride.place) ||
    // неизменённый флаг правка не пишет: точность новой точки — `patch.startPrecise ?? ride.startPrecise`
    (ride.startPrecise === true &&
      ride.geo !== undefined &&
      (patch.startPrecise ?? ride.startPrecise) &&
      patch.geo !== undefined &&
      !samePoint(ride.geo, patch.geo))
  );
}
