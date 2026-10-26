import {
  type FieldErrorCode,
  RIDE_MAX_PARTICIPANTS,
  RIDE_START_MAX_AHEAD_DAYS,
  RIDE_START_MIN_LEAD_MIN,
  type RidePhase,
  type RideViewer,
} from '@pokatim/contracts';

import type { RideDoc } from './rides.collection';

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
} as const;

type PhaseInput = Pick<RideDoc, 'status' | 'startsAt'>;

/** Фаза не хранится: `cancelled` (статус) → `past` (`now ≥ startsAt`) → `upcoming`. */
export function ridePhase(ride: PhaseInput, now: Date): RidePhase {
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
 */
export function rideViewer(
  ride: PhaseInput & Pick<RideDoc, 'organizerUserId' | 'goingCount' | 'limit'>,
  viewer: RideViewerInput | null,
  now: Date,
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
  };
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
 * Правка меняет время, город или место старта. «Перенос» (`rescheduledAt`) — только если при этом идут другие
 * участники: это условие проверяет сама запись по счётчику документа в момент операции (репозиторий), а не
 * прочитанный заранее `goingCount` — первый участник мог записаться между чтением и правкой.
 */
export function changesStart(
  ride: Pick<RideDoc, 'startsAt' | 'cityCode' | 'place'>,
  patch: { startsAt?: Date; cityCode?: RideDoc['cityCode']; place?: string },
): boolean {
  return (
    (patch.startsAt !== undefined && patch.startsAt.getTime() !== ride.startsAt.getTime()) ||
    (patch.cityCode !== undefined && patch.cityCode !== ride.cityCode) ||
    (patch.place !== undefined && patch.place !== ride.place)
  );
}
