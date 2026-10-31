import type { LonLat, RideCard, RidePhase } from '@pokatim/contracts';

/**
 * Порт `rides` для модуля `social` («Свои», ADR-0027 п. 1, через `modules/rides/index.ts`): факты райда для явки —
 * участники, фаза, старт и точная точка старта; ближайший райд райдера карточкой ленты («Идёт», P3). `social` коллекцию
 * `rides` не читает и фазу не вычисляет. Метод P5 (райды по окну старта) добавляется в своём PR.
 */
export const RIDES_FOR_SOCIAL = Symbol('RIDES_FOR_SOCIAL');

export interface SocialRideFacts {
  rideId: string;
  /** `ridePhase(doc, now)` — считает `rides`; `social` фазу не вычисляет */
  phase: RidePhase;
  startsAt: Date;
  organizerUserId: string;
  /** «Иду», организатор первым */
  participantIds: string[];
  /** точка старта при `startPrecise` (маршрут каталога), иначе `null` — только ручная явка (K2) */
  preciseStart: LonLat | null;
}

export interface RidesForSocial {
  /** Нет райда — `null`; скрытый и отменённый отдаются с фазой — решает `social`. */
  rideFacts(rideId: string, now: Date): Promise<SocialRideFacts | null>;
  /**
   * «Идёт» (K6, P3): ближайший опубликованный райд со стартом позже `now`, где `riderId` — участник «Иду» (организатор —
   * первый участник), `startsAt ↑, _id ↑`; карточка со зрителем `viewerId` (роль, canJoin — `rideViewer`). Нет — null.
   */
  nextRideCard(riderId: string, viewerId: string, now: Date): Promise<RideCard | null>;
}
