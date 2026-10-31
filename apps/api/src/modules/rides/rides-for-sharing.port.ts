import type { LonLat } from '@pokatim/contracts';

/**
 * Порт `rides` для модуля `sharing` (карточка-приглашение, ADR-0018, через `modules/rides/index.ts`): публичные факты
 * будущего райда и линия его маршрута из каталога; OG-картинка (og-images) — факты опубликованного райда и пререндер. `sharing` коллекций `rides`/`routes` не читает.
 */
export const RIDES_FOR_SHARING = Symbol('RIDES_FOR_SHARING');

/** Факты карточки — только публичные поля райда (как `GET /v1/rides/:id`), без организатора и участников. */
export interface RideInviteFacts {
  rideId: string;
  title: string;
  startsAt: Date;
  place: string;
  distanceKm: number;
  paceMinKmh: number;
  paceMaxKmh: number;
  /** маршрут, который **сейчас в каталоге** (`public`); свой маршрут организатора (`private`) и висячий — `null` */
  routeId: string | null;
  /** фото организатора (ride-photo, ADR-0028): id текущего фото или `null`; рисует только `night` (4a), OG — нет */
  photoId: string | null;
}

export interface RidesForSharing {
  /**
   * Факты карточки для зрителя `userId`. Райда нет или он скрыт (и организатору) — 404 `NOT_FOUND`; не будущий
   * опубликованный (отменён, прошёл) — `null`.
   */
  inviteFacts(userId: string, rideId: string): Promise<RideInviteFacts | null>;
  /**
   * Байты фото для рендера 4a (только worker): только пока райд не скрыт и `photoId` — его текущее фото; иначе `null`
   * (вход устарел — картинка не нужна, ретраить нечего).
   */
  invitePhoto(rideId: string, photoId: string): Promise<Uint8Array | null>;
  /** Линия показа маршрута, пока он в каталоге (только worker); иначе `null`. */
  inviteLine(routeId: string): Promise<LonLat[] | null>;
  /**
   * Факты OG-картинки (og-images): только опубликованный райд (любая фаза, без зрителя); скрытый, отменённый,
   * неизвестный — `null` (не 404: решает вызывающий). `routeId` — только маршрут каталога.
   */
  ogFacts(rideId: string): Promise<RideInviteFacts | null>;
  /** Опубликованные райды, изменившиеся строго после курсора, по `(updatedAt, _id)`, не больше `limit`. */
  ogChanged(
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
}
