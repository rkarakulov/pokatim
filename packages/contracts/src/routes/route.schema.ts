import { z } from 'zod';

import { PageQuery, Uuid } from '../common.ts';
import { CITY_CODES, CityCode } from '../geo/city.schema.ts';
import { PageCursor, RaceTitle, SURFACES, SurfaceList } from '../races/race.schema.ts';
import { CatalogRouteElevation } from './route-catalog.schema.ts';

/*
 * Маршрут команды платформы — эталон коридора гонки (race-results-01, ADR-0012 п. 1). Загружается в панели файлом
 * GPX, разбирается в worker; готовый маршрут не меняется. Схемы этого файла — панель (строгие: SPA деплоится с API);
 * приложение (свои маршруты райдера, routes-02) — `my-route.schema.ts`.
 */

/** Лимит файла маршрута: сервер отвечает `413 ROUTE_TOO_LARGE`, панель проверяет до отправки. */
export const ROUTE_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Происхождение маршрута (routes-02): `platform` — маршрут команды (панель, каталог, коридоры); `rider` — личный
 * маршрут райдера из приложения, виден только автору. Только в конец.
 */
export const ROUTE_ORIGINS = ['platform', 'rider'] as const;
export type RouteOrigin = (typeof ROUTE_ORIGINS)[number];

/** Расширения файла маршрута (routes-02): совпадают с `ROUTE_FILE_EXTENSIONS` пакета `@pokatim/tracks`. */
export const ROUTE_FILE_EXTENSIONS = ['gpx', 'kml'] as const;

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

/**
 * `POST /v1/admin/routes?title=…` (`races.manage`) и `POST /v1/routes/mine?title=…` (вход, routes-02); тело — байты
 * GPX или KML (`application/octet-stream`).
 */
export const UploadRouteQuery = z.strictObject({ title: RouteTitle });
export type UploadRouteQuery = z.infer<typeof UploadRouteQuery>;

/**
 * `POST /v1/admin/routes/:id/publish` (`races.manage`, routes-01) → `PanelRoute`: публикация готового маршрута в
 * каталог или правка города и покрытия опубликованного (момент публикации прежний). Название не меняется (RC-14).
 */
export const PublishRouteInput = z.strictObject({ city: CityCode, surfaces: SurfaceList });
export type PublishRouteInput = z.infer<typeof PublishRouteInput>;

/** Каталожные поля маршрута в панели; `null` — не опубликован (снят или не публиковался). */
export const PanelRouteCatalog = z.object({
  city: z.enum(CITY_CODES),
  surfaces: z.array(z.enum(SURFACES)),
  publishedAt: z.iso.datetime(),
});
export type PanelRouteCatalog = z.infer<typeof PanelRouteCatalog>;

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
  /** routes-01: публикация в каталоге; обязательное поле — панель деплоится с API. */
  catalog: PanelRouteCatalog.nullable(),
});
export type PanelRouteSummary = z.infer<typeof PanelRouteSummary>;

/**
 * `GET /v1/admin/routes/:id`, ответ загрузки: + линия показа [lon, lat] (≤ 1000 точек; `[]`, пока не готов) и профиль
 * высоты (routes-05, A4: `null` — нет высот или маршрут не готов; ответ без поля — `null`).
 */
export const PanelRoute = PanelRouteSummary.extend({
  line: z.array(z.tuple([z.number(), z.number()])).max(1000),
  elevation: CatalogRouteElevation.nullable().default(null),
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
