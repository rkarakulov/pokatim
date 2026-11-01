import type { LonLat, RideCard, RidePhase } from '@pokatim/contracts';

import type { ChangedCursor } from '../../changed-since';

/**
 * Порт `rides` для модуля `social` («Свои», ADR-0027 п. 1, через `modules/rides/index.ts`): факты райда для явки —
 * участники, фаза, старт и точная точка старта; ближайший райд райдера карточкой ленты («Идёт», P3). `social` коллекцию
 * `rides` не читает и фазу не вычисляет. P5: райды участника по окну старта (автоявка) и начавшиеся опубликованные
 * райды по окну старта (регламент «Как прошёл райд?»). P7: ближайшие райды «своих» для Главной.
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

/** Начавшийся опубликованный райд для регламента «Как прошёл райд?» (P5). */
export interface SocialStartedRide {
  rideId: string;
  startsAt: Date;
  /** «Иду», организатор первым */
  participantIds: string[];
}

/** Райд Главной «Свои» (social-p7): карточка ленты со зрителем и участники «Иду» (организатор первым). */
export interface SocialUpcomingRide {
  card: RideCard;
  participantIds: string[];
}

/** Предел `ridesOfParticipant` за вызов. */
export const SOCIAL_PARTICIPANT_RIDES_MAX = 20;

export interface RidesForSocial {
  /** Нет райда — `null`; скрытый и отменённый отдаются с фазой — решает `social`. */
  rideFacts(rideId: string, now: Date): Promise<SocialRideFacts | null>;
  /**
   * «Идёт» (K6, P3): ближайший опубликованный райд со стартом позже `now`, где `riderId` — участник «Иду» (организатор —
   * первый участник), `startsAt ↑, _id ↑`; карточка со зрителем `viewerId` (роль, canJoin — `rideViewer`). Нет — null.
   */
  nextRideCard(riderId: string, viewerId: string, now: Date): Promise<RideCard | null>;
  /**
   * Автоявка (P5): райды, где `userId` — участник «Иду» или организатор, со стартом в `[from, to]` (включительно),
   * `startsAt ↑`, ≤ `SOCIAL_PARTICIPANT_RIDES_MAX`; любой статус — фазу (`now`) и отказ решает `social`.
   */
  ridesOfParticipant(userId: string, from: Date, to: Date, now: Date): Promise<SocialRideFacts[]>;
  /**
   * Регламент «Как прошёл райд?» (P5): опубликованные райды со стартом в окне `(after, until]` по `(startsAt, _id)`
   * (`changedWithin`; пустой `id` курсора — время курсора включительно), ≤ `limit`; `next` — последний прочитанный,
   * `null` — страница пуста. Отменённые и скрытые не отдаются.
   */
  startedRidesWithin(
    after: ChangedCursor,
    until: Date,
    limit: number,
  ): Promise<{ rides: SocialStartedRide[]; next: ChangedCursor | null }>;
  /**
   * Главная «Свои» (K7, social-p7): опубликованные райды со стартом в `(now, until]`, где участник «Иду» или
   * организатор — кто-то из `riderIds`; `startsAt ↑, _id ↑`, ≤ `limit`; карточка — как в ленте, со зрителем `viewerId`.
   */
  upcomingWithRiders(
    riderIds: readonly string[],
    viewerId: string,
    now: Date,
    until: Date,
    limit: number,
  ): Promise<SocialUpcomingRide[]>;
}
