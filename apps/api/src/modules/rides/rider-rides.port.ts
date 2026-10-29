/**
 * Порт `rides` для модуля `achievements` (через `modules/rides/index.ts`): прошедшие райды райдера по условиям истории
 * профиля (R8) — опубликованный (не отменён, не скрыт), старт в прошлом, райдер «Иду» или организатор. `achievements`
 * коллекции `rides` не читает.
 */
export const RIDER_RIDES = Symbol('RIDER_RIDES');

/** Предел райдов на одно чтение: при усечении теряются новые, а не первые (порядок ↑); больше — лог, без отказа. */
export const RIDER_RIDES_MAX_ROWS = 2000;

export interface RiderRideFact {
  rideId: string;
  title: string;
  startsAt: Date;
  /** райдер — организатор райда */
  organizer: boolean;
  /** «Иду», включая организатора (он — первый участник) */
  goingCount: number;
}

export interface RiderRides {
  /** Прошедшие райды райдера: `startsAt ↑`, при равенстве `rideId ↑`. */
  pastOf(userId: string): Promise<RiderRideFact[]>;
}
