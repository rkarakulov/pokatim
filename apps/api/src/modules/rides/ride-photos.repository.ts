import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Binary, Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type RidePhotoDoc, ridePhotosCollections } from './ride-photos.collection';

/**
 * Единственный писатель `ride_photos` (ride-photo, ADR-0028): вставка и удаление — в транзакциях сервисов `rides`
 * после записи райда; `bytes` читает только `findBytes` (отдача, рендер приглашения).
 */
@Injectable()
export class RidePhotosRepository {
  private readonly photos: Collection<RidePhotoDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.photos = ridePhotosCollections(db).photos;
  }

  async insert(tx: DbSession, doc: RidePhotoDoc): Promise<void> {
    await this.photos.insertOne(doc, { session: tx });
  }

  /** Удалить фото райда по id (повтор — no-op). */
  async delete(tx: DbSession, id: string, rideId: string): Promise<void> {
    await this.photos.deleteOne({ _id: id, rideId }, { session: tx });
  }

  /** Байты и райд фото; нет — `null`. */
  findBytes(id: string): Promise<Pick<RidePhotoDoc, 'rideId' | 'bytes'> | null> {
    return this.photos.findOne<{ rideId: string; bytes: Binary }>(
      { _id: id },
      { projection: { _id: 0, rideId: 1, bytes: 1 } },
    );
  }

  /** Стирание аккаунта (ADR-0015): все фото организатора (индекс `ride_photos_organizer_idx`). */
  async deleteAllOf(organizerUserId: string): Promise<number> {
    const result = await this.photos.deleteMany({ organizerUserId });
    return result.deletedCount;
  }
}
