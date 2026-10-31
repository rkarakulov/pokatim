import type { Bounds } from '@pokatim/tracks';

import type { RouteMatchGeometry } from './route-geometry.port';

/**
 * Порт `routes` для модуля `route-rides` (route-rides-01, через `modules/routes/index.ts`): маршрут, видимый райдеру
 * **сейчас** — в каталоге (`IN_CATALOG`) или свой готовый (`ownRider`), — и его линия сверки для worker. Без кэша:
 * публикация изменяема, маршрут райдера удаляем (`pokatim-security.md`). `RouteCatalog`/`RouteGeometry` видят только
 * маршруты платформы и не меняются.
 */
export const ROUTE_RIDE_ROUTES = Symbol('ROUTE_RIDE_ROUTES');

export interface RideableRoute {
  id: string;
  title: string;
  distanceM: number;
  isLoop: boolean;
  /** рамка линии показа `[west, south, east, north]` */
  bounds: Bounds;
  /** `own` — свой маршрут райдера, иначе — каталог */
  access: 'catalog' | 'own';
}

export interface RouteRideRoutes {
  /** `IN_CATALOG` или свой готовый (`ownRider`), без кэша; иначе (нет, чужой непубличный, не готов) — `null`. */
  rideable(routeId: string, userId: string): Promise<RideableRoute | null>;
  /** Те же условия видимости; линия сверки для worker; нет геометрии — `null`. */
  matchGeometry(routeId: string, userId: string): Promise<RouteMatchGeometry | null>;
  /**
   * Названия видимых райдеру маршрутов (achievements): то же условие, что `rideable` (без проверки линии показа),
   * одним запросом, ≤ 500 id; невидимых нет в карте. Пустой вход — пустая карта без запроса.
   */
  rideableTitles(routeIds: readonly string[], userId: string): Promise<Map<string, string>>;
  /**
   * Свои готовые маршруты райдера (`ownRider`, `ready`, длина есть), новые → старые (`_id` убыв.), не больше `limit`
   * (route-rides-03: план автопроверки, «Мои маршруты»).
   */
  ownReadyIds(userId: string, limit: number): Promise<string[]>;
  /**
   * Рамки линий показа видимых райдеру маршрутов (условие `rideable`), ≤ 25 id одним запросом маршрутов и одним —
   * линий (route-rides-03: фильтр `boundsNear` плана автопроверки); невидимых и без линии нет в карте. Пустой вход —
   * пустая карта без запроса.
   */
  rideableBounds(routeIds: readonly string[], userId: string): Promise<Map<string, Bounds>>;
}
