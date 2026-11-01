/**
 * Порт `routes` для модуля `social` («Свои» P4, через `modules/routes/index.ts`): маршрут райдера в каталоге — цель
 * «Респекта автору» (K8). `social` коллекции `routes` не читает; `routes` о `social` не знает.
 */
export const ROUTES_FOR_SOCIAL = Symbol('ROUTES_FOR_SOCIAL');

/** Цель «Респекта автору»; `authorUserId` наружу не выходит. */
export interface RouteRespectTarget {
  routeId: string;
  authorUserId: string;
}

export interface RoutesForSocial {
  /** Готовый маршрут райдера (`origin: 'rider'`) в каталоге (`IN_CATALOG`); команды, заявка, скрытый — `null`. */
  respectTarget(routeId: string): Promise<RouteRespectTarget | null>;
}
