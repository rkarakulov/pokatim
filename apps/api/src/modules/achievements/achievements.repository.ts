import { Inject, Injectable } from '@nestjs/common';
import type { AchievementCode } from '@pokatim/contracts';
import { isDuplicateKey, MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import {
  type AchievementGrantDoc,
  type AchievementsCollections,
  achievementsCollections,
} from './achievements.collection';
import type { Earned } from './achievements.policy';

/** Уникальный индекс выдачи (`0035_achievements`): параллельная вставка — `isDuplicateKey`. */
export const ACHIEVEMENT_GRANTS_UNIQUE_INDEX = 'achievement_grants_user_code_unique';

/** Выдача без служебных полей записи. */
export type StoredGrantDoc = Pick<
  AchievementGrantDoc,
  'code' | 'object' | 'factAt' | 'seenAt' | 'revokedAt'
>;

/**
 * Единственный писатель `achievement_grants`, `achievement_syncs` (ADR-0020). Каждый фильтр — с `userId`; каждая
 * запись — одна условная операция над одним документом, без транзакций (RC-2): параллельные сверки одного райдера
 * сходятся к одному состоянию.
 */
@Injectable()
export class AchievementsRepository {
  private readonly c: AchievementsCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = achievementsCollections(db);
  }

  /** Все выдачи пользователя, включая отозванные (≤ 9 — уникальный индекс). */
  listOf(userId: string): Promise<StoredGrantDoc[]> {
    return this.c.grants
      .find<StoredGrantDoc>(
        { userId },
        { projection: { _id: 0, code: 1, object: 1, factAt: 1, seenAt: 1, revokedAt: 1 } },
      )
      .toArray();
  }

  /** Маркер первой сверки; нет — `null` (сверка будет «первой», A3). */
  async syncedAt(userId: string): Promise<Date | null> {
    return (await this.c.syncs.findOne({ _id: userId }))?.firstSyncAt ?? null;
  }

  /** Вставка выдачи; дубль уникального индекса (проигравший параллельный GET) — `false`, не ошибка. */
  async insertGrant(
    userId: string,
    code: AchievementCode,
    earned: Earned,
    seenAt: Date | null,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.c.grants.insertOne({
        _id: uuidv7(),
        userId,
        code,
        object: earned.object,
        factAt: earned.factAt,
        grantedAt: now,
        seenAt,
        revokedAt: null,
        updatedAt: now,
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error, ACHIEVEMENT_GRANTS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }

  /** Отзыв видимой выдачи (A4); уже отозванная — без записи. */
  async revoke(userId: string, code: AchievementCode, now: Date): Promise<boolean> {
    const result = await this.c.grants.updateOne(
      { userId, code, revokedAt: null },
      { $set: { revokedAt: now, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  /** Восстановление или обновление объекта: `seenAt` и `grantedAt` не трогаются (A4: «вернулся — `seen` прежний»). */
  async restoreOrRefresh(
    userId: string,
    code: AchievementCode,
    earned: Earned,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.grants.updateOne(
      { userId, code },
      { $set: { object: earned.object, factAt: earned.factAt, revokedAt: null, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  /** Маркер первой сверки — только после её выдач (RC-1); дубль параллельного upsert — не ошибка. */
  async markSynced(userId: string, now: Date): Promise<void> {
    try {
      await this.c.syncs.updateOne(
        { _id: userId },
        { $setOnInsert: { firstSyncAt: now } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
    }
  }

  /** «Показано»: только свои видимые непросмотренные; остальные — без записи. */
  async markSeen(userId: string, codes: readonly AchievementCode[], now: Date): Promise<number> {
    const result = await this.c.grants.updateMany(
      { userId, code: { $in: [...codes] }, revokedAt: null, seenAt: null },
      { $set: { seenAt: now, updatedAt: now } },
    );
    return result.modifiedCount;
  }

  /** Стирание удалённого аккаунта (ADR-0015): выдачи и маркер; повтор — нули. */
  async deleteAllOf(userId: string): Promise<{ grants: number; syncs: number }> {
    const grants = await this.c.grants.deleteMany({ userId });
    const syncs = await this.c.syncs.deleteOne({ _id: userId });
    return { grants: grants.deletedCount, syncs: syncs.deletedCount };
  }
}
