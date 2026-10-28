/**
 * Порт `tracks` для модуля `riders` (rider-profile, через `modules/tracks/index.ts`): суммы своих заездов для
 * статистики профиля. Отдельный порт: `ActivitySource` не расширяется (его реализуют фейки других модулей).
 */
export const ACTIVITY_TOTALS = Symbol('ACTIVITY_TOTALS');

export interface ActivityTotalsResult {
  /** основных велоактивностей (без дублей и `other`) */
  activities: number;
  /** сумма дистанций, м (не округлена) */
  distanceM: number;
  /** сумма набора высоты, м (`null` у активности — 0) */
  elevationGainM: number;
}

export interface ActivityTotals {
  /** Только свои основные активности (`duplicateOf: null`), кроме `sport: other` (RC-A4). Нет — нули. */
  of(userId: string): Promise<ActivityTotalsResult>;
}
