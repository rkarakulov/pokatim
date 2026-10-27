import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { MULTI_LINE, optionalText, PageQuery, Uuid, Version } from '../common.ts';
import { CITY_CODES, CityCode } from '../geo/city.schema.ts';
import { PageCursor, SURFACES, SurfaceList } from '../races/race.schema.ts';
import { CatalogRouteElevation } from './route-catalog.schema.ts';
import {
  ROUTE_PUBLICATION_COMMENT_MAX,
  RoutePublicationStatus,
  RouteRejectionReason,
} from './route-publication.schema.ts';
import { RouteReportReason } from './route-report.schema.ts';

/*
 * Модерация маршрутов райдеров в панели «Протокол» (routes-06, право `routes.moderate`): очереди «На проверке»,
 * «Жалобы», «Скрытые», карточка заявки с линией и профилем, действия с причиной в журнале. Панель — строгие enum-ы.
 * Наружу — без имени автора (N8) и без автора жалобы; автор — только id (`Райдер ·<id>`).
 */

/** Вкладки: `pending` — старые заявки сверху; `reported` — открытые жалобы на опубликованные; `hidden` — скрытые. */
export const RIDER_ROUTE_MODERATION_STATES = ['pending', 'reported', 'hidden'] as const;
export const RiderRouteModerationState = z.enum(RIDER_ROUTE_MODERATION_STATES);
export type RiderRouteModerationState = z.infer<typeof RiderRouteModerationState>;

/** Решение по жалобе на маршрут: закрыта скрытием или отклонена. */
export const ROUTE_REPORT_RESOLUTIONS = ['hidden', 'dismissed'] as const;

/** Карточка — не больше 100 последних жалоб. */
export const MODERATION_ROUTE_REPORTS_MAX = 100;
export const RIDER_ROUTE_MODERATION_MAX_LIMIT = 50;

/** `GET /v1/admin/rider-routes?state&cursor&limit` → `RiderRouteModerationPage`. */
export const RiderRouteModerationQuery = z.strictObject({
  ...PageQuery.shape,
  state: RiderRouteModerationState.default('pending'),
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(RIDER_ROUTE_MODERATION_MAX_LIMIT).default(20),
});
export type RiderRouteModerationQuery = z.infer<typeof RiderRouteModerationQuery>;

/** Строка очереди: `topReason` — самая частая открытая причина жалоб (ничья — порядок справочника). */
export const RiderRouteModerationRow = z.object({
  id: Uuid,
  title: z.string(),
  authorUserId: Uuid,
  status: RoutePublicationStatus,
  city: z.enum(CITY_CODES),
  surfaces: z.array(z.enum(SURFACES)),
  distanceM: z.number().int(),
  submittedAt: z.iso.datetime(),
  openReportCount: z.number().int().nonnegative(),
  topReason: RouteReportReason.nullable(),
  lastReportAt: z.iso.datetime().nullable(),
  hiddenAt: z.iso.datetime().nullable(),
});
export type RiderRouteModerationRow = z.infer<typeof RiderRouteModerationRow>;

export const RiderRouteModerationPage = z.object({
  items: z.array(RiderRouteModerationRow),
  nextCursor: z.string().nullable(),
});
export type RiderRouteModerationPage = z.infer<typeof RiderRouteModerationPage>;

/** Жалоба в карточке — без автора. */
export const RiderRouteModerationReport = z.object({
  id: Uuid,
  reason: RouteReportReason,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolution: z.enum(ROUTE_REPORT_RESOLUTIONS).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type RiderRouteModerationReport = z.infer<typeof RiderRouteModerationReport>;

/**
 * `GET /v1/admin/rider-routes/:id` и ответы действий: заявка, состояние, `version` для действий, цифры, линия показа
 * (≤ 1000 точек), профиль высоты и до 100 последних жалоб (новые сверху). Без имени автора (N8).
 */
export const RiderRouteModerationDetail = z.object({
  id: Uuid,
  title: z.string(),
  authorUserId: Uuid,
  showAuthorName: z.boolean(),
  status: RoutePublicationStatus,
  city: z.enum(CITY_CODES),
  surfaces: z.array(z.enum(SURFACES)),
  submittedAt: z.iso.datetime(),
  submissionCount: z.number().int().nonnegative(),
  decidedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  rejection: z.object({ reason: RouteRejectionReason, comment: z.string().nullable() }).nullable(),
  hiddenAt: z.iso.datetime().nullable(),
  openReportCount: z.number().int().nonnegative(),
  lastReportAt: z.iso.datetime().nullable(),
  version: Version,
  distanceM: z.number().int(),
  elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean(),
  line: z.array(z.tuple([z.number(), z.number()])).max(1000),
  elevation: CatalogRouteElevation.nullable(),
  reports: z.array(RiderRouteModerationReport).max(MODERATION_ROUTE_REPORTS_MAX),
});
export type RiderRouteModerationDetail = z.infer<typeof RiderRouteModerationDetail>;

/** `POST /v1/admin/rider-routes/:id/approve` — из `pending`; город и покрытие — правка модератора (A2). */
export const ApproveRiderRouteRequest = z.strictObject({
  version: Version,
  city: CityCode,
  surfaces: SurfaceList,
});
export type ApproveRiderRouteRequest = z.infer<typeof ApproveRiderRouteRequest>;

/** `POST …/:id/reject` — из `pending`; причина — справочник, комментарий автору необязателен. */
export const RejectRiderRouteRequest = z.strictObject({
  version: Version,
  reason: RouteRejectionReason,
  comment: optionalText(ROUTE_PUBLICATION_COMMENT_MAX, MULTI_LINE).optional(),
});
export type RejectRiderRouteRequest = z.infer<typeof RejectRiderRouteRequest>;

/** `POST …/:id/hide` — из `approved`; закрывает открытые жалобы. */
export const HideRiderRouteRequest = z.strictObject({ version: Version, reason: ActionReason });
export type HideRiderRouteRequest = z.infer<typeof HideRiderRouteRequest>;

/** `POST …/:id/restore` — из `hidden` в `approved` с прежней датой публикации. */
export const RestoreRiderRouteRequest = z.strictObject({ version: Version, reason: ActionReason });
export type RestoreRiderRouteRequest = z.infer<typeof RestoreRiderRouteRequest>;

/**
 * `POST …/:id/dismiss-reports` — закрыть открытые жалобы без смены маршрута. `lastReportAt` — из карточки: пришла
 * новая жалоба — `409 CONFLICT`.
 */
export const DismissRiderRouteReportsRequest = z.strictObject({
  version: Version,
  reason: ActionReason,
  lastReportAt: z.iso.datetime(),
});
export type DismissRiderRouteReportsRequest = z.infer<typeof DismissRiderRouteReportsRequest>;
