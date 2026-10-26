/** Порт `profile` для `results` (через `modules/profile/index.ts`): публичные имена только с согласием (P1). */
export const RIDER_NAMES = Symbol('RIDER_NAMES');

export interface RiderNameDirectory {
  /** Только `publicName !== null && showNameInResults === true`; пустой вход — пустая карта без запроса. */
  publicNames(userIds: readonly string[]): Promise<Map<string, string>>;
}
