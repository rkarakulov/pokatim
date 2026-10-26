import type { Bounds, CorridorGeometry } from '@pokatim/tracks';

/**
 * Порт `routes` для модуля `results` (через `modules/routes/index.ts`): линия сверки готового маршрута (вход
 * `analyzeAttempt` без допуска гонки) и рамка линии показа (предфильтр автоматических попыток). Готовый маршрут
 * неизменяем — реализация кэширует в процессе.
 */
export const ROUTE_GEOMETRY = Symbol('ROUTE_GEOMETRY');

export type RouteMatchGeometry = Omit<CorridorGeometry, 'widthM'>;

export interface RouteGeometry {
  /** только `ready`; иначе `null` */
  matchGeometry(routeId: string): Promise<RouteMatchGeometry | null>;
  /** рамка линии показа готового маршрута; иначе `null` */
  bounds(routeId: string): Promise<Bounds | null>;
}
