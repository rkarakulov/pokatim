/**
 * Маршрут райда (05c): название, длина, набор и старт **видимого** маршрута. `public` — маршрут сейчас в каталоге
 * (`IN_CATALOG`), `private` — свой готовый маршрут райдера (видит только он, организатор райда).
 */
export interface RideRouteRef {
  id: string;
  title: string;
  distanceM: number;
  elevationGainM: number | null;
  /** `[lon, lat]` */
  start: [number, number];
  access: 'public' | 'private';
}

/**
 * Порт `routes` для модуля `rides` (через `modules/routes/index.ts`, 05c, 8.1 RC-2). Отдельно от `RouteCatalog`: тот
 * читает только маршруты платформы и кэширует. Здесь — без кэша (публикация изменяема, маршрут райдера удаляем), а
 * условия видимости — только `IN_CATALOG` и `ownRider` репозитория.
 */
export const RIDE_ROUTES = Symbol('RIDE_ROUTES');

/** Предел id маршрутов `publicStartsWithin` (принятое ограничение «Рядом», ADR-0014, 05c). */
export const PUBLIC_STARTS_CAP = 500;

export interface RideRoutes {
  /** Можно ли прикрепить: в каталоге → `public`; иначе свой готовый маршрут организатора → `private`; иначе `null`. */
  attachable(routeId: string, organizerUserId: string): Promise<RideRouteRef | null>;
  /**
   * Видимые маршруты по id (≤ 200, без кэша): в каталоге → `public`; иначе, если задан `ownerUserId`, — его готовый
   * маршрут → `private`. Остальных id в результате нет (нет, чужой, не готов, удалён).
   */
  visible(
    routeIds: readonly string[],
    ownerUserId: string | null,
  ): Promise<Map<string, RideRouteRef>>;
  /**
   * Id маршрутов **в каталоге** (готовых), чей старт в круге (`center` — `[lon, lat]`, км), не больше
   * `PUBLIC_STARTS_CAP` (по `_id`): кандидаты «Рядом» с точной точкой (05c, фиксы ревью pass 2) — только по публичным
   * данным. Сверх предела маршруты в кандидаты не попадают (принятое ограничение: райд виден в «Рядом» по городу).
   */
  publicStartsWithin(center: readonly [number, number], radiusKm: number): Promise<string[]>;
  /** Id маршрутов райдера — стирание аккаунта сбрасывает точки райдов на них (ADR-0015). */
  ownedRouteIds(userId: string): Promise<string[]>;
  /**
   * Какие из id маршрутов ещё существуют (любой статус и происхождение) — стирание аккаунта сбрасывает точки райдов на
   * висячих `routeId` (маршрут удалён раньше, 05c, RC-1).
   */
  existing(routeIds: readonly string[]): Promise<Set<string>>;
  /**
   * Линия показа `[lon, lat]` маршрута **в каталоге** (без кэша; карточка-приглашение райда, ADR-0018): не в каталоге,
   * не готов, без линии — `null`. Свой непубличный маршрут организатора не отдаётся никогда — картинка уходит наружу.
   */
  catalogLine(routeId: string): Promise<[number, number][] | null>;
}
