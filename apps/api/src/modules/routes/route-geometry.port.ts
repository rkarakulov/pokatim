import type { Bounds, CorridorGeometry } from '@pokatim/tracks';

/**
 * Порт `routes` (через `modules/routes/index.ts`). `results`: линия сверки готового маршрута (вход `analyzeAttempt` без
 * допуска гонки) и рамка линии показа (предфильтр автоматических попыток). `races`: линия показа для карты коридора
 * (ADR-0014). Готовый маршрут неизменяем — реализация кэширует в процессе.
 */
export const ROUTE_GEOMETRY = Symbol('ROUTE_GEOMETRY');

export type RouteMatchGeometry = Omit<CorridorGeometry, 'widthM'>;

export interface RouteGeometry {
  /** только `ready`; иначе `null` */
  matchGeometry(routeId: string): Promise<RouteMatchGeometry | null>;
  /** рамка линии показа готового маршрута; иначе `null` */
  bounds(routeId: string): Promise<Bounds | null>;
  /** линия показа, старт, финиш и рамка — только `ready`; иначе `null` */
  displayGeometry(routeId: string): Promise<RouteDisplayGeometry | null>;
}

/** Линия показа готового маршрута для карты (ADR-0014): `[lon, lat]`, ≤ 1000 точек; без линии сверки. */
export interface RouteDisplayGeometry {
  line: [number, number][];
  start: [number, number];
  finish: [number, number];
  bounds: Bounds;
}
