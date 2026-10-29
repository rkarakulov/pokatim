import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { PageCursor, RACE_STATUSES } from '../races/race.schema.ts';
import { PROTOCOL_ROW_STATUSES } from '../results/results-admin.schema.ts';
import {
  ENTRY_TIERS,
  RACE_RESULT_STATUSES,
  RESULT_GROUP_KEYS,
  RESULT_UNRANKED_REASONS,
} from '../results/results.schema.ts';
import { AvatarId, RiderPublicId } from './rider-avatar.schema.ts';

/** Страница историй профиля (rider-profile): по умолчанию 10, не больше 20. */
export const RIDER_HISTORY_MAX_LIMIT = 20;

/**
 * `GET /v1/profile/races|rides`, `GET /v1/riders/:publicId/races` — `?cursor&limit`; курсор непрозрачный, мусор — 400.
 */
export const RiderHistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(RIDER_HISTORY_MAX_LIMIT).default(10),
  cursor: PageCursor.optional(),
});
export type RiderHistoryQuery = z.infer<typeof RiderHistoryQuery>;

/** Гонка в строке истории и лучших местах: id, название, начало окна. */
const RiderRaceRef = z.object({
  id: Uuid,
  title: z.string(),
  windowStartsAt: z.iso.datetime(),
});

/** Лучшее место по опубликованным протоколам (текущая ревизия). */
export const RiderBestPlace = z.object({
  race: RiderRaceRef,
  place: z.number().int(),
  tied: z.boolean(),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
});
export type RiderBestPlace = z.infer<typeof RiderBestPlace>;

/**
 * `GET /v1/profile/stats` (`no-store`, только свой): заезды, км и набор по своим основным активностям (без дублей и
 * не велосипедных), строки опубликованных протоколов (`races` — с местом, `podiums` — места 1–3), до трёх лучших мест.
 * Считает сервер; метры — целые.
 */
export const RiderStats = z.object({
  activities: z.number().int(),
  distanceM: z.number().int(),
  elevationGainM: z.number().int(),
  races: z.number().int(),
  podiums: z.number().int(),
  /** «в зачёте» + финиши без места (START, Verified без пульса) по опубликованным протоколам; старый сервер — 0 */
  finishes: z.number().int().default(0),
  bestPlaces: z.array(RiderBestPlace).max(3),
});
export type RiderStats = z.infer<typeof RiderStats>;

/** Строка «Гонки» своего профиля: результат — как в «моём участии» гонки. */
export const RiderRaceHistoryItem = z.object({
  race: RiderRaceRef.extend({
    windowEndsAt: z.iso.datetime(),
    status: tolerantEnum(RACE_STATUSES),
  }),
  result: z.object({
    status: tolerantEnum(RACE_RESULT_STATUSES),
    place: z.number().int().nullable(),
    tied: z.boolean(),
    elapsedSec: z.number().int().nullable(),
    unranked: tolerantEnum(RESULT_UNRANKED_REASONS).nullable().default(null),
  }),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  tier: tolerantEnum(ENTRY_TIERS),
});
export type RiderRaceHistoryItem = z.infer<typeof RiderRaceHistoryItem>;

/** `GET /v1/profile/races` — свои заявки без снятых, новые гонки сверху. */
export const RiderRaceHistoryPage = z.object({
  items: z.array(RiderRaceHistoryItem),
  nextCursor: z.string().nullable(),
});
export type RiderRaceHistoryPage = z.infer<typeof RiderRaceHistoryPage>;

/** Роль в райде истории: организатор или «Иду». */
export const RIDER_RIDE_ROLES = ['organizer', 'participant'] as const;
export type RiderRideRole = (typeof RIDER_RIDE_ROLES)[number];

/** Строка «Райды» своего профиля: прошедший неотменённый райд; дистанция — плановая организатора. */
export const RiderRideHistoryItem = z.object({
  id: Uuid,
  title: z.string(),
  startsAt: z.iso.datetime(),
  distanceKm: z.number(),
  role: tolerantEnum(RIDER_RIDE_ROLES),
});
export type RiderRideHistoryItem = z.infer<typeof RiderRideHistoryItem>;

/** `GET /v1/profile/rides` — новые сверху. */
export const RiderRideHistoryPage = z.object({
  items: z.array(RiderRideHistoryItem),
  nextCursor: z.string().nullable(),
});
export type RiderRideHistoryPage = z.infer<typeof RiderRideHistoryPage>;

/**
 * `GET /v1/riders/:publicId` (публично, `public, max-age=60`): только при имени и согласии на показ, иначе 404. Без
 * `userId`, км, набора и райдов; лучшее место — число.
 */
export const PublicRiderProfile = z.object({
  publicId: RiderPublicId,
  name: z.string(),
  club: z.string().nullable(),
  avatar: z.object({ id: AvatarId }).nullable(),
  stats: z.object({
    races: z.number().int(),
    podiums: z.number().int(),
    bestPlace: z.number().int().nullable(),
    /** как `RiderStats.finishes` */
    finishes: z.number().int().default(0),
  }),
});
export type PublicRiderProfile = z.infer<typeof PublicRiderProfile>;

/**
 * Строка публичной истории: только гонки с опубликованным протоколом — строка текущей ревизии или финиш без места
 * (START, Verified без пульса: `place: null`, `status: 'final'`, `unranked`).
 */
export const PublicRiderRace = z.object({
  race: RiderRaceRef,
  place: z.number().int().nullable(),
  tied: z.boolean(),
  status: tolerantEnum(PROTOCOL_ROW_STATUSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  elapsedSec: z.number().int(),
  /** финиш без места; строка протокола и старый сервер — `null` */
  unranked: tolerantEnum(RESULT_UNRANKED_REASONS).nullable().default(null),
});
export type PublicRiderRace = z.infer<typeof PublicRiderRace>;

/** `GET /v1/riders/:publicId/races` — новые сверху. */
export const PublicRiderRacePage = z.object({
  items: z.array(PublicRiderRace),
  nextCursor: z.string().nullable(),
});
export type PublicRiderRacePage = z.infer<typeof PublicRiderRacePage>;
