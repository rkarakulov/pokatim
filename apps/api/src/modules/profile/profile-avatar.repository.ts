import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { PROFILE_COLLECTIONS, type ProfileAvatarDoc } from './profile.collection';

/**
 * Единственный писатель `profile_avatars` (rider-profile, сторож — `profile.repository.test.ts`). Значения фильтров —
 * `userId` из access и id после zod.
 */
@Injectable()
export class ProfileAvatarRepository {
  private readonly avatars: Collection<ProfileAvatarDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.avatars = db.collection<ProfileAvatarDoc>(PROFILE_COLLECTIONS.avatars);
  }

  /** Новый аватар — в транзакции замены вместе с записью профиля. */
  async insert(session: DbSession, doc: ProfileAvatarDoc): Promise<void> {
    await this.avatars.insertOne(doc, { session });
  }

  /** Прежний аватар пользователя — в транзакции замены или удаления (чужой id не удаляется). */
  async delete(session: DbSession, id: string, userId: string): Promise<void> {
    await this.avatars.deleteOne({ _id: id, userId }, { session });
  }

  /** Байты для отдачи `GET /v1/avatars/:id`; нет — `null`. */
  async findBytes(id: string): Promise<Uint8Array | null> {
    const doc = await this.avatars.findOne({ _id: id }, { projection: { bytes: 1 } });
    return doc ? doc.bytes.buffer : null;
  }

  /** Стирание удалённого аккаунта (`ProfileErasure`): все аватары пользователя (индекс `{ userId }`). */
  async deleteAllOf(userId: string): Promise<number> {
    return (await this.avatars.deleteMany({ userId })).deletedCount;
  }
}
