import { z } from 'zod';

import { PageQuery, Uuid } from '../common.ts';
import { PageCursor, RaceTitle } from '../races/race.schema.ts';

/*
 * Маршрут команды платформы — эталон коридора гонки (race-results-01, ADR-0012 п. 1). Загружается в панели файлом
 * GPX, разбирается в worker; готовый маршрут не меняется. Только панель (строгие схемы: SPA деплоится с API).
 */

/** Лимит файла маршрута: сервер отвечает `413 ROUTE_TOO_LARGE`, панель проверяет до отправки. */
export const ROUTE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const ROUTE_STATUSES = ['processing', 'ready', 'failed'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

/** Причина отказа разбора; `timeout` ставит worker (поток разбора не уложился в лимит времени). */
export const ROUTE_FAILURE_CODES = [
  'unreadable',
  'no_track',
  'too_many_points',
  'too_short',
  'too_long',
  'timeout',
] as const;
export type RouteFailureCode = (typeof ROUTE_FAILURE_CODES)[number];

/** Название маршрута — как у гонки: 3–120 символов, одна строка. */
export const RouteTitle = RaceTitle;

/** `POST /v1/admin/routes?title=…` (`races.manage`), тело — байты GPX (`application/octet-stream`). */
export const UploadRouteQuery = z.strictObject({ title: RouteTitle });
export type UploadRouteQuery = z.infer<typeof UploadRouteQuery>;

/** Маршрут в списке панели; длина, набор и петля — `null`, пока маршрут не готов. */
export const PanelRouteSummary = z.object({
  id: Uuid,
  title: z.string(),
  status: z.enum(ROUTE_STATUSES),
  failure: z.enum(ROUTE_FAILURE_CODES).nullable(),
  distanceM: z.number().int().nullable(),
  elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean().nullable(),
  owner: z.object({ userId: Uuid, displayName: z.string() }),
  createdAt: z.iso.datetime(),
});
export type PanelRouteSummary = z.infer<typeof PanelRouteSummary>;

/** `GET /v1/admin/routes/:id`, ответ загрузки: + линия показа [lon, lat] (≤ 1000 точек; `[]`, пока не готов). */
export const PanelRoute = PanelRouteSummary.extend({
  line: z.array(z.tuple([z.number(), z.number()])).max(1000),
});
export type PanelRoute = z.infer<typeof PanelRoute>;

/**
 * `GET /v1/admin/routes` (`races.read`): новые сверху, курсор. `status=ready` — все готовые маршруты платформы; без
 * `status` — готовые + свои необработанные (`processing`, `failed`).
 */
export const PanelRouteQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: PageCursor.optional(),
  status: z.literal('ready').optional(),
});
export type PanelRouteQuery = z.infer<typeof PanelRouteQuery>;

export const PanelRoutePage = z.object({
  items: z.array(PanelRouteSummary),
  nextCursor: z.string().nullable(),
});
export type PanelRoutePage = z.infer<typeof PanelRoutePage>;
