import type { DbSession } from '../../db';

/**
 * Готовый маршрут для коридора гонки: название и длина, м; петля и расстояние между концами, м — проверка ворот
 * при выборе коридора (`CORRIDOR_GATES_OVERLAP`).
 */
export interface ReadyRoute {
  id: string;
  title: string;
  distanceM: number;
  isLoop: boolean;
  endsDistanceM: number;
}

/**
 * Порт `routes` для модуля `races` (через `modules/routes/index.ts`): готовый маршрут по id — в транзакции правки
 * гонки (`ready` терминален и маршрут не удаляется — замок не нужен); названия маршрутов списка гонок одним запросом.
 * Линия сверки — порт `RouteGeometry` (`results`).
 */
export const ROUTE_CATALOG = Symbol('ROUTE_CATALOG');

export interface RouteCatalog {
  findReady(id: string, tx?: DbSession): Promise<ReadyRoute | null>;
  summaries(ids: readonly string[]): Promise<Map<string, { title: string }>>;
}
