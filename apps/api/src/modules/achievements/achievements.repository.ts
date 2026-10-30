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
  'code' | 'object' | 'factAt' | 'seenAt' | 'revokedAt' | 'level' | 'seenLevel'
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
        {
          projection: {
            _id: 0,
            code: 1,
            object: 1,
            factAt: 1,
            seenAt: 1,
            revokedAt: 1,
            level: 1,
            seenLevel: 1,
          },
        },
      )
      .toArray();
  }

  /** Маркер первой сверки; нет — `null` (сверка будет «первой», A3). */
  async syncedAt(userId: string): Promise<Date | null> {
    return (await this.c.syncs.findOne({ _id: userId }))?.firstSyncAt ?? null;
  }

  /**
   * Вставка выдачи с уровнем; просмотренная (первая сверка, A3) — показан и текущий уровень (`seenLevel`). Дубль
   * уникального индекса (проигравший параллельный GET) — `false`, не ошибка.
   */
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
        level: earned.level,
        seenLevel: seenAt === null ? null : earned.level,
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

  /**
   * Восстановление отозванной (`restore`) или обновление объекта и уровня видимой (`refresh`): `seenAt`, `seenLevel` и
   * `grantedAt` не трогаются (A4: «вернулся — `seen` прежний»; L3: возврат на показанный уровень не вспыхивает).
   * Условие на `revokedAt` — устаревший параллельный план не снимает свежий отзыв (ревью PR A, LOW-1).
   */
  async restoreOrRefresh(
    userId: string,
    code: AchievementCode,
    earned: Earned,
    revoked: boolean,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.grants.updateOne(
      { userId, code, revokedAt: revoked ? { $ne: null } : null },
      {
        $set: {
          object: earned.object,
          factAt: earned.factAt,
          level: earned.level,
          revokedAt: null,
          updatedAt: now,
        },
      },
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

  /**
   * «Показано»: только свои видимые, у которых не показан текущий уровень; остальные — без записи. Одна условная
   * операция (update pipeline): `seenLevel` берётся из `level` того же документа в момент записи (клиент уровень не
   * присылает) и монотонен (`$max`); `seenAt` — первый показ. Поля v1 (`level`/`seenLevel` нет) ≡ 1.
   */
  async markSeen(userId: string, codes: readonly AchievementCode[], now: Date): Promise<number> {
    const result = await this.c.grants.updateMany(
      {
        userId,
        code: { $in: [...codes] },
        revokedAt: null,
        $expr: {
          $or: [
            { $eq: [{ $ifNull: ['$seenAt', null] }, null] },
            { $lt: [{ $ifNull: ['$seenLevel', 1] }, { $ifNull: ['$level', 1] }] },
          ],
        },
      },
      [
        {
          $set: {
            seenAt: { $ifNull: ['$seenAt', now] },
            seenLevel: { $max: [{ $ifNull: ['$seenLevel', 1] }, { $ifNull: ['$level', 1] }] },
            updatedAt: now,
          },
        },
      ],
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
