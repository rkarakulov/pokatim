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
}
