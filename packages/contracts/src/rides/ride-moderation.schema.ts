import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { PageQuery, Uuid, Version } from '../common.ts';
import { CITY_CODES } from '../geo/city.schema.ts';
import { PageCursor } from '../races/race.schema.ts';
import {
  RIDE_CANCEL_REASONS,
  RIDE_LIST_MAX_LIMIT,
  RIDE_PHASES,
  RIDE_STATUSES,
} from './ride.schema.ts';
import { RideReportReason } from './ride-report.schema.ts';

/*
 * Модерация кофе-райдов в панели «Протокол» (05b, право `rides.moderate`): очередь райдов с открытыми жалобами и
 * скрытых, карточка, «Скрыть» / «Вернуть» / «Отклонить жалобы» с причиной в журнале. Панель — строгие enum-ы.
 * Наружу — без автора жалобы и id организатора.
 */

/** Вкладки очереди: `open` — есть открытые жалобы (новые сверху), `hidden` — скрытые (по времени скрытия). */
export const RIDE_MODERATION_STATES = ['open', 'hidden'] as const;
export const RideModerationState = z.enum(RIDE_MODERATION_STATES);
export type RideModerationState = z.infer<typeof RideModerationState>;

/** Решение по жалобе: закрыта скрытием райда или отклонена. */
export const RIDE_REPORT_RESOLUTIONS = ['hidden', 'dismissed'] as const;

/** Карточка — не больше 100 последних жалоб. */
export const MODERATION_RIDE_REPORTS_MAX = 100;

/** `GET /v1/admin/rides?state&cursor&limit` → `ModerationRidePage`. */
export const ModerationRideQuery = z.strictObject({
  ...PageQuery.shape,
  state: RideModerationState.default('open'),
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(RIDE_LIST_MAX_LIMIT).default(20),
});
export type ModerationRideQuery = z.infer<typeof ModerationRideQuery>;

/** Строка очереди: `topReason` — самая частая открытая причина (ничья — порядок справочника), нет открытых — `null`. */
export const ModerationRideRow = z.object({
  id: Uuid,
  title: z.string(),
  city: z.enum(CITY_CODES),
  startsAt: z.iso.datetime(),
  status: z.enum(RIDE_STATUSES),
  phase: z.enum(RIDE_PHASES),
  openReportCount: z.number().int().nonnegative(),
  topReason: RideReportReason.nullable(),
  lastReportAt: z.iso.datetime().nullable(),
  hiddenAt: z.iso.datetime().nullable(),
});
export type ModerationRideRow = z.infer<typeof ModerationRideRow>;

export const ModerationRidePage = z.object({
  items: z.array(ModerationRideRow),
  nextCursor: z.string().nullable(),
});
export type ModerationRidePage = z.infer<typeof ModerationRidePage>;

/** Жалоба в карточке модерации — без автора. */
export const ModerationRideReport = z.object({
  id: Uuid,
  reason: RideReportReason,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolution: z.enum(RIDE_REPORT_RESOLUTIONS).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type ModerationRideReport = z.infer<typeof ModerationRideReport>;

/**
 * `GET /v1/admin/rides/:id` и ответы действий: райд целиком (организатор — только подпись), состояние модерации,
 * `version` для действий и до 100 последних жалоб (новые сверху).
 */
export const ModerationRideDetail = z.object({
  id: Uuid,
  title: z.string(),
  organizerName: z.string().nullable(),
  startsAt: z.iso.datetime(),
  city: z.enum(CITY_CODES),
  place: z.string(),
  distanceKm: z.number(),
  paceMinKmh: z.number(),
  paceMaxKmh: z.number(),
  limit: z.number().nullable(),
  goingCount: z.number(),
  description: z.string().nullable(),
  status: z.enum(RIDE_STATUSES),
  phase: z.enum(RIDE_PHASES),
  cancelReason: z.enum(RIDE_CANCEL_REASONS).nullable(),
  rescheduledAt: z.iso.datetime().nullable(),
  hiddenAt: z.iso.datetime().nullable(),
  openReportCount: z.number().int().nonnegative(),
  lastReportAt: z.iso.datetime().nullable(),
  version: Version,
  reports: z.array(ModerationRideReport).max(MODERATION_RIDE_REPORTS_MAX),
});
export type ModerationRideDetail = z.infer<typeof ModerationRideDetail>;

/** `POST /v1/admin/rides/:id/hide` — из `published`/`cancelled`; закрывает открытые жалобы. */
export const HideRideRequest = z.strictObject({ version: Version, reason: ActionReason });
export type HideRideRequest = z.infer<typeof HideRideRequest>;

/** `POST /v1/admin/rides/:id/restore` — из `hidden` в прежний статус; жалобы не трогает. */
export const RestoreRideRequest = z.strictObject({ version: Version, reason: ActionReason });
export type RestoreRideRequest = z.infer<typeof RestoreRideRequest>;

/**
 * `POST /v1/admin/rides/:id/dismiss-reports` — закрыть открытые жалобы без смены райда. `lastReportAt` — из карточки:
 * пришла новая жалоба — `409 CONFLICT` (модератор не закроет жалобу, которую не видел).
 */
export const DismissRideReportsRequest = z.strictObject({
  version: Version,
  reason: ActionReason,
  lastReportAt: z.iso.datetime(),
});
export type DismissRideReportsRequest = z.infer<typeof DismissRideReportsRequest>;
