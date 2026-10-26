import { z } from 'zod';

/** Предел линии показа маршрута — как упрощение `@pokatim/tracks` (`LINE_MAX_POINTS`). */
export const RACE_ROUTE_MAX_POINTS = 1000;

/** Точка `[lon, lat]` (WGS84). */
export const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LonLat = z.infer<typeof LonLat>;

/**
 * `GET /v1/races/:id/route` — линия показа коридора гонки (ADR-0014, maps-01): публичная, только опубликованная или
 * отменённая гонка с коридором и готовым маршрутом. Без `routeId`, линии сверки, sha256 и названия маршрута.
 * `bounds` — `[west, south, east, north]`, `widthM` — допуск коридора в метрах в каждую сторону.
 */
export const RaceRouteMap = z.object({
  line: z.array(LonLat).min(2).max(RACE_ROUTE_MAX_POINTS),
  start: LonLat,
  finish: LonLat,
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  widthM: z.number().positive(),
});
export type RaceRouteMap = z.infer<typeof RaceRouteMap>;
