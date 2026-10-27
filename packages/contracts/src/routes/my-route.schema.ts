import { z } from 'zod';

import { PageQuery, tolerantEnum, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import { ROUTE_FAILURE_CODES, ROUTE_STATUSES, RouteTitle } from './route.schema.ts';
import { MyRoutePublication } from './route-publication.schema.ts';

/*
 * Мои маршруты (routes-02): личные маршруты райдера из приложения (GPX/KML), видны только автору. Ответы
 * приложения — справочники `tolerantEnum` (R6); без происхождения, владельца, sha256, попыток, каталога и линий.
 * Загрузка — `POST /v1/routes/mine?title=…` (`UploadRouteQuery`), тело — байты файла; карта — `RouteMapGeometry`.
 */

/** Предел числа своих маршрутов райдера: больше — `409 ROUTE_QUOTA_EXCEEDED`. */
export const MY_ROUTE_MAX_COUNT = 100;
export const MY_ROUTE_LIST_MAX_LIMIT = 50;

/**
 * Свой маршрут в списке и карточке; длина, набор и петля — `null`, пока маршрут не готов (набор — и без высот).
 * routes-06: `publication` — заявка в каталог (`null` — не подавался, отозван или снят), `canPublish` — можно подать
 * (считает сервер); дефолты — новый клиент против старого API.
 */
export const MyRoute = z.object({
  id: Uuid,
  title: z.string(),
  status: tolerantEnum(ROUTE_STATUSES),
  failure: tolerantEnum(ROUTE_FAILURE_CODES).nullable(),
  distanceM: z.number().int().nullable(),
  elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean().nullable(),
  createdAt: z.iso.datetime(),
  publication: MyRoutePublication.nullable().default(null),
  canPublish: z.boolean().default(false),
});
export type MyRoute = z.infer<typeof MyRoute>;

/** `GET /v1/routes/mine?cursor&limit`: свои маршруты, новые сверху. */
export const MyRoutePage = z.object({ items: z.array(MyRoute), nextCursor: z.string().nullable() });
export type MyRoutePage = z.infer<typeof MyRoutePage>;

export const MyRouteQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(MY_ROUTE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
});
export type MyRouteQuery = z.infer<typeof MyRouteQuery>;

/** `POST /v1/routes/mine/:id/rename` → `MyRoute`; название — те же правила, что у загрузки. */
export const RenameRouteInput = z.strictObject({ title: RouteTitle });
export type RenameRouteInput = z.infer<typeof RenameRouteInput>;
