/**
 * Порт `profile` (через `modules/profile/index.ts`): `results` — публичные имена только с согласием (P1); `routes`
 * (routes-06) — имя автора маршрута каталога, согласие — галочка заявки маршрута.
 */
export const RIDER_NAMES = Symbol('RIDER_NAMES');

export interface RiderNameDirectory {
  /** Только `publicName !== null && showNameInResults === true`; пустой вход — пустая карта без запроса. */
  publicNames(userIds: readonly string[]): Promise<Map<string, string>>;
  /**
   * Имя автора маршрута (routes-06, U3): `publicName` — строка, **без** условия `showNameInResults` (согласие —
   * `publication.showAuthorName` заявки); пустой вход — пустая карта без запроса. Читается на каждом запросе каталога.
   */
  attributionNames(userIds: readonly string[]): Promise<Map<string, string>>;
}
