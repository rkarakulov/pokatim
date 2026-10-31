import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RIDE_PHOTOS_COLLECTIONS } from '../../modules/rides/ride-photos.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы фото райда (ride-photo, ADR-0028): одно фото на райд (замена в транзакции — «удалить прежний → вставить
 * новый») и фото организатора (стирание аккаунта, ADR-0015).
 */
export const RIDE_PHOTOS_INDEXES = {
  ride: { key: { rideId: 1 }, options: { name: 'ride_photos_ride_unique', unique: true } },
  organizer: { key: { organizerUserId: 1 }, options: { name: 'ride_photos_organizer_idx' } },
} as const satisfies Record<string, IndexDef>;

/**
 * Коллекция `ride_photos` и её индексы. `rides.photoId` — без бэкфилла (чтение `?? null`) и без индекса (поиск по
 * `_id` райда). Expand-only, без транзакции, идемпотентна. После `0045_social`.
 */
export const ridePhotos: MongoMigration = {
  id: '0046_ride_photos',
  async up(db) {
    await ensureCollection(db, RIDE_PHOTOS_COLLECTIONS.photos);
    for (const { key, options } of Object.values(RIDE_PHOTOS_INDEXES)) {
      await db.collection(RIDE_PHOTOS_COLLECTIONS.photos).createIndex(key, options);
    }
  },
};
