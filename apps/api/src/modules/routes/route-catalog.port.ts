import type { DbSession } from '../../db';

/** Готовый маршрут для коридора гонки: название и длина, м. */
export interface ReadyRoute {
  id: string;
  title: string;
  distanceM: number;
}

/**
 * Порт `routes` для модуля `races` (через `modules/routes/index.ts`): готовый маршрут по id — в транзакции правки
 * гонки (`ready` терминален и маршрут не удаляется — замок не нужен); названия маршрутов списка гонок одним запросом.
 * Линию сверки (слайс 02) даст отдельный порт.
 */
export const ROUTE_CATALOG = Symbol('ROUTE_CATALOG');

export interface RouteCatalog {
  findReady(id: string, tx?: DbSession): Promise<ReadyRoute | null>;
  summaries(ids: readonly string[]): Promise<Map<string, { title: string }>>;
}
