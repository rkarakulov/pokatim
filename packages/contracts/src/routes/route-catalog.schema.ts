import { z } from 'zod';

import { fieldError, PageQuery, queryArray, tolerantEnum, Uuid } from '../common.ts';
import { CITY_CODES, CityCode, isCityCode } from '../geo/city.schema.ts';
import { RACE_LIST_MAX_LIMIT } from '../races/race-public.schema.ts';
import { LonLat, RACE_ROUTE_MAX_POINTS } from '../races/race-route.schema.ts';
import { PageCursor, SURFACES, Surface } from '../races/race.schema.ts';

/*
 * Каталог маршрутов команды (routes-01): публичное чтение без входа — только маршруты, опубликованные сотрудником
 * в панели. Ответы приложения — `tolerantEnum` справочников (R6); без владельца, sha256, статуса, отказа, попыток и
 * линии сверки.
 */

/** Корзины дистанции фильтра: `lt50` < 50 км, `50to100` — [50; 100] км, `gt100` > 100 км. Только в конец. */
export const ROUTE_DISTANCE_BUCKETS = ['lt50', '50to100', 'gt100'] as const;
export const RouteDistanceBucket = z.enum(ROUTE_DISTANCE_BUCKETS, { error: fieldError('INVALID') });
export type RouteDistanceBucket = z.infer<typeof RouteDistanceBucket>;

export const CATALOG_ROUTE_LIST_MAX_LIMIT = 50;

/**
 * `GET /v1/routes?city&distance&surface&cursor&limit` → `CatalogRoutePage`: новые публикации сверху. Внутри фильтра —
 * ИЛИ (покрытие — хотя бы одно из выбранных), между фильтрами — И; лишние ключи — 400.
 */
export const CatalogRouteQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(CATALOG_ROUTE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
  city: queryArray(CityCode, CITY_CODES.length).optional(),
  distance: queryArray(RouteDistanceBucket, ROUTE_DISTANCE_BUCKETS.length).optional(),
  surface: queryArray(Surface, SURFACES.length).optional(),
});
export type CatalogRouteQuery = z.infer<typeof CatalogRouteQuery>;

/** Маршрут каталога в списке; длина и набор — метры, набор `null` — нет высот в GPX. */
export const CatalogRouteCard = z.object({
  id: Uuid,
  title: z.string(),
  distanceM: z.number().int(),
  elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean(),
  city: tolerantEnum(CITY_CODES),
  surfaces: z.array(tolerantEnum(SURFACES)),
  publishedAt: z.iso.datetime(),
});
export type CatalogRouteCard = z.infer<typeof CatalogRouteCard>;

/** `GET /v1/routes/:id` — те же поля, что в списке; не опубликован или неизвестен — 404. */
export const CatalogRouteDetail = CatalogRouteCard;
export type CatalogRouteDetail = z.infer<typeof CatalogRouteDetail>;

export const CatalogRoutePage = z.object({
  items: z.array(CatalogRouteCard),
  nextCursor: z.string().nullable(),
});
export type CatalogRoutePage = z.infer<typeof CatalogRoutePage>;

/** `GET /v1/routes/cities` — коды городов старта опубликованных маршрутов; незнакомые отбрасываются. */
export const CatalogRouteCities = z.object({
  cities: z.array(z.string()).transform((codes) => codes.filter(isCityCode)),
});
export type CatalogRouteCities = z.output<typeof CatalogRouteCities>;

/**
 * `GET /v1/routes/:id/map` — линия показа (≤ 1000 точек `[lon, lat]`), старт, финиш, рамка `[west, south, east,
 * north]`; без коридора и линии сверки. Общая часть с `RaceRouteMap` (тот присваивается этому типу).
 */
export const RouteMapGeometry = z.object({
  line: z.array(LonLat).min(2).max(RACE_ROUTE_MAX_POINTS),
  start: LonLat,
  finish: LonLat,
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type RouteMapGeometry = z.infer<typeof RouteMapGeometry>;

/** `GET /v1/routes/:id/races?cursor&limit` → `RacePage`: публичные гонки с коридором по маршруту, новые сверху. */
export const CatalogRouteRacesQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(RACE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
});
export type CatalogRouteRacesQuery = z.infer<typeof CatalogRouteRacesQuery>;
