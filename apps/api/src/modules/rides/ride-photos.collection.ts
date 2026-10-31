import type { Binary, Collection, Db } from 'mongodb';

/** Фото организатора райда (ride-photo, ADR-0028). Создаёт миграция `0046_ride_photos`; писатель — `RidePhotosRepository`. */
export const RIDE_PHOTOS_COLLECTIONS = { photos: 'ride_photos' } as const;

/**
 * Фото райда: перекодированный JPEG без метаданных (исходник не хранится), ≤ 1600 px по длинной стороне (≈ 0,2–0,5
 * МБ — в пределах документа). Одно на райд (уникальный `rideId`); замена — новый `_id` (случайный токен), прежний
 * удаляется той же транзакцией. `bytes` читаются только отдачей и рендером приглашения, остальное — проекцией без них.
 */
export interface RidePhotoDoc {
  _id: string;
  rideId: string;
  organizerUserId: string;
  bytes: Binary;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  bytesLength: number;
  createdAt: Date;
}

export function ridePhotosCollections(db: Db): { photos: Collection<RidePhotoDoc> } {
  return { photos: db.collection<RidePhotoDoc>(RIDE_PHOTOS_COLLECTIONS.photos) };
}
