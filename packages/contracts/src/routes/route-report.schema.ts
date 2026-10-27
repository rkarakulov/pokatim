import { z } from 'zod';

import { fieldError, MULTI_LINE, optionalText } from '../common.ts';

/*
 * Жалоба на маршрут райдера в каталоге (routes-06, A4): вошедший райдер (не автор) жалуется один раз; маршруты команды
 * жалоб не принимают. Очередь и решения — в панели (`route-moderation.schema.ts`).
 */

/** Причины жалобы (U5); подписи — `domain.routeReportReason.*`. Только в конец. */
export const ROUTE_REPORT_REASONS = [
  'dangerous',
  'impassable',
  'private_area',
  'offensive_title',
  'spam',
  'other',
] as const;
export const RouteReportReason = z.enum(ROUTE_REPORT_REASONS, { error: fieldError('REQUIRED') });
export type RouteReportReason = z.infer<typeof RouteReportReason>;

export const ROUTE_REPORT_COMMENT_MAX = 500;

/**
 * `POST /v1/routes/:id/reports` → 200 `CatalogRouteViewer` (`reported: true`). Повтор — идемпотентный успех
 * (комментарий второй попытки не сохраняется). Пустой комментарий — `null`.
 */
export const CreateRouteReportRequest = z.strictObject({
  reason: RouteReportReason,
  comment: optionalText(ROUTE_REPORT_COMMENT_MAX, MULTI_LINE).optional(),
});
export type CreateRouteReportRequest = z.infer<typeof CreateRouteReportRequest>;

/**
 * `GET /v1/routes/:id/me` — состояние вошедшего зрителя карточки каталога: можно ли пожаловаться (маршрут райдера, не
 * свой, ещё не жаловался) и жаловался ли.
 */
export const CatalogRouteViewer = z.object({ canReport: z.boolean(), reported: z.boolean() });
export type CatalogRouteViewer = z.infer<typeof CatalogRouteViewer>;
