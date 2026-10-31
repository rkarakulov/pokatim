import type { ChangedCursor, RiderChanges } from '../../changed-since';

/**
 * Порт `route-rides` для модуля `achievements` (через `modules/route-rides/index.ts`): пройденные заезды райдера,
 * видимые ему сейчас (как «Заезды по маршруту»): статус `passed`, активность жива, маршрут виден райдеру (в каталоге
 * или свой готовый). Снятый, скрытый, удалённый маршрут — заездов нет (RC-4). `achievements` коллекций не читает.
 */
export const RIDER_ROUTE_RIDES = Symbol('RIDER_ROUTE_RIDES');

/** Предел заездов на одно чтение (порядок не задан); больше — лог, без отказа. */
export const RIDER_ROUTE_RIDES_MAX_ROWS = 2000;

export interface RiderRouteRideFact {
  routeId: string;
  /** текущее название маршрута */
  routeTitle: string;
  /** старт активности заезда */
  startedAt: Date;
}

export interface RiderRouteRides {
  /** Пройденные видимые заезды райдера (повторы одного маршрута — отдельными фактами). Порядок не задан. */
  passedOf(userId: string): Promise<RiderRouteRideFact[]>;
  /**
   * Райдеры заездов `passed`, записанных в окне `(after, until]` по `(updatedAt, _id)` — момент записи итога (серверная
   * сверка достижений, achievements-push; видимость проверит сверка через `passedOf`). Предел — `limit` заездов;
   * курсор — последний прочитанный заезд.
   */
  passedRidersAfter(after: ChangedCursor, until: Date, limit: number): Promise<RiderChanges>;
  /**
   * Текущие названия маршрутов из `routeIds`, видимых райдеру сейчас (каталог или свой готовый — та же видимость, что у
   * `passedOf`, RC-4): объект ручной выдачи достижения и его название в ответах (achievements-panel). Нет в карте — не
   * виден.
   */
  routeTitles(userId: string, routeIds: readonly string[]): Promise<Map<string, string>>;
}
