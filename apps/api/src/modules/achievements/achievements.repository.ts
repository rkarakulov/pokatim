import { Inject, Injectable } from '@nestjs/common';
import {
  type AchievementCode,
  isSeasonalCode,
  type SeasonalAchievementRef,
} from '@pokatim/contracts';
import { isDuplicateKey, MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type AchievementGrantDoc,
  type AchievementSeasonGrantDoc,
  type AchievementsCollections,
  achievementsCollections,
} from './achievements.collection';
import type {
  Earned,
  FactAchievementCode,
  SeasonalEarned,
  SeasonalKey,
} from './achievements.policy';

/** Уникальный индекс выдачи (`0035_achievements`): параллельная вставка — `isDuplicateKey`. */
export const ACHIEVEMENT_GRANTS_UNIQUE_INDEX = 'achievement_grants_user_code_unique';
/** Уникальный индекс сезонной выдачи (`0043_achievements_seasonal`). */
export const ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX =
  'achievement_season_grants_user_code_season_unique';

/** Сезонная выдача без служебных полей записи. */
export type StoredSeasonGrantDoc = Pick<
  AchievementSeasonGrantDoc,
  'code' | 'seasonId' | 'factAt' | 'seenAt' | 'revokedAt'
>;

/** Выдача без служебных полей записи. */
export type StoredGrantDoc = Pick<
  AchievementGrantDoc,
  'code' | 'object' | 'factAt' | 'seenAt' | 'revokedAt' | 'level' | 'seenLevel' | 'notifiedLevel'
>;

/** Документ выдачи до записи `refresh`/`restore` — по нему решается, нужно ли уведомление (`noticeDue`). */
export type GrantBefore = Pick<
  AchievementGrantDoc,
  '_id' | 'revokedAt' | 'seenAt' | 'seenLevel' | 'level' | 'notifiedLevel'
>;

/** Выдача по id для порта уведомлений (`ACHIEVEMENT_NOTICES`): несезонная или сезонная. */
export type NoticeGrant =
  | ({ grant: 'fact' } & Pick<AchievementGrantDoc, 'userId' | 'code' | 'revokedAt' | 'level'>)
  | ({ grant: 'season' } & Pick<
      AchievementSeasonGrantDoc,
      'userId' | 'code' | 'seasonId' | 'revokedAt'
    >);

/**
 * Единственный писатель `achievement_grants`, `achievement_season_grants`, `achievement_syncs` (ADR-0020). Каждый фильтр
 * — с `userId` или `_id` своей коллекции; каждая запись — одна условная операция над одним документом (RC-2):
 * параллельные сверки одного райдера сходятся к одному состоянию. Шаги, которые могут дать уведомление
 * (achievements-push), сверка выполняет в транзакции с outbox — методы с `session` (`*InTx`, `restoreOrRefresh`).
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
            notifiedLevel: 1,
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
   * Вставка выдачи с уровнем; просмотренная (первая сверка, A3) — показан и текущий уровень (`seenLevel`); объявлен —
   * текущий уровень (`notifiedLevel`: первая сверка тихая, о нём уже не сообщаем). Дубль уникального индекса
   * (проигравший параллельный GET) — `false`, не ошибка.
   */
  async insertGrant(
    userId: string,
    code: FactAchievementCode,
    earned: Earned,
    seenAt: Date | null,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.c.grants.insertOne(grantDoc(uuidv7(), userId, code, earned, seenAt, now));
      return true;
    } catch (error) {
      if (isDuplicateKey(error, ACHIEVEMENT_GRANTS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }

  /**
   * Вставка выдачи в транзакции сверки (не первая сверка, `seenAt: null`) с заранее выданным `_id` (он же — в событии).
   * Дубль уникального индекса **не** перехватывается: внутри транзакции он её обрывает — сверка ловит
   * `isDuplicateKey(…, ACHIEVEMENT_GRANTS_UNIQUE_INDEX)` снаружи `MongoTransactions.run` (откат, события нет).
   */
  async insertGrantInTx(
    tx: DbSession,
    id: string,
    userId: string,
    code: FactAchievementCode,
    earned: Earned,
    now: Date,
  ): Promise<void> {
    await this.c.grants.insertOne(grantDoc(id, userId, code, earned, null, now), { session: tx });
  }

  /** Отзыв видимой выдачи (A4); уже отозванная — без записи. */
  async revoke(userId: string, code: FactAchievementCode, now: Date): Promise<boolean> {
    const result = await this.c.grants.updateOne(
      { userId, code, revokedAt: null },
      { $set: { revokedAt: now, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  /**
   * Восстановление отозванной (`restore`) или обновление объекта и уровня видимой (`refresh`): `seenAt`, `seenLevel` и
   * `grantedAt` не трогаются (A4: «вернулся — `seen` прежний»; L3: возврат на показанный уровень не вспыхивает).
   * Условие на `revokedAt` — устаревший параллельный план не снимает свежий отзыв (ревью PR A, LOW-1). Одна условная
   * операция (`findOneAndUpdate`, pipeline): `notifiedLevel = $max(notifiedLevel ?? level ?? 1, новый ранг)` (поля v1 —
   * `$ifNull`); возвращает документ **до** записи (по нему `noticeDue`) или `null` — условие не выполнено. В транзакции
   * сверки — с `session`: конфликт с параллельной сверкой повторяет колбэк, повтор видит закоммиченный `notifiedLevel`.
   */
  async restoreOrRefresh(
    userId: string,
    code: FactAchievementCode,
    earned: Earned,
    revoked: boolean,
    now: Date,
    tx?: DbSession,
  ): Promise<GrantBefore | null> {
    const rank = earned.level ?? 1;
    return this.c.grants.findOneAndUpdate(
      { userId, code, revokedAt: revoked ? { $ne: null } : null },
      [
        {
          $set: {
            object: { $literal: earned.object },
            factAt: { $literal: earned.factAt },
            level: { $literal: earned.level },
            revokedAt: null,
            updatedAt: { $literal: now },
            notifiedLevel: {
              $max: [{ $ifNull: ['$notifiedLevel', { $ifNull: ['$level', 1] }] }, rank],
            },
          },
        },
      ],
      {
        returnDocument: 'before',
        projection: { _id: 1, revokedAt: 1, seenAt: 1, seenLevel: 1, level: 1, notifiedLevel: 1 },
        ...(tx ? { session: tx } : {}),
      },
    );
  }

  /** Сезонные выдачи пользователя, включая отозванные (префикс `userId` уникального индекса). */
  listSeasonalOf(userId: string): Promise<StoredSeasonGrantDoc[]> {
    return this.c.seasonGrants
      .find<StoredSeasonGrantDoc>(
        { userId },
        { projection: { _id: 0, code: 1, seasonId: 1, factAt: 1, seenAt: 1, revokedAt: 1 } },
      )
      .toArray();
  }

  /** Вставка сезонной выдачи (S3); дубль уникального индекса (параллельный GET) — `false`, не ошибка. */
  async insertSeasonal(
    userId: string,
    earned: SeasonalEarned,
    seenAt: Date | null,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.c.seasonGrants.insertOne(seasonGrantDoc(uuidv7(), userId, earned, seenAt, now));
      return true;
    } catch (error) {
      if (isDuplicateKey(error, ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }

  /** Вставка сезонной выдачи в транзакции сверки — как `insertGrantInTx` (дубль ловит сверка снаружи транзакции). */
  async insertSeasonalInTx(
    tx: DbSession,
    id: string,
    userId: string,
    earned: SeasonalEarned,
    now: Date,
  ): Promise<void> {
    await this.c.seasonGrants.insertOne(seasonGrantDoc(id, userId, earned, null, now), {
      session: tx,
    });
  }

  /** Выдача по `_id` для порта уведомлений; стёрта (удалённый аккаунт) или неизвестна — `null`. */
  async findGrant(kind: 'fact' | 'season', id: string): Promise<NoticeGrant | null> {
    if (kind === 'fact') {
      const doc = await this.c.grants.findOne(
        { _id: id },
        { projection: { _id: 0, userId: 1, code: 1, revokedAt: 1, level: 1 } },
      );
      return doc && { grant: 'fact', ...doc };
    }
    const doc = await this.c.seasonGrants.findOne(
      { _id: id },
      { projection: { _id: 0, userId: 1, code: 1, seasonId: 1, revokedAt: 1 } },
    );
    return doc && { grant: 'season', ...doc };
  }

  /** Отзыв видимой сезонной выдачи (S4); уже отозванная — без записи. */
  async revokeSeasonal(userId: string, key: SeasonalKey, now: Date): Promise<boolean> {
    const result = await this.c.seasonGrants.updateOne(
      { userId, code: key.code, seasonId: key.seasonId, revokedAt: null },
      { $set: { revokedAt: now, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  /** Восстановление отозванной сезонной выдачи (S4): `seenAt` и `grantedAt` не трогаются. */
  async restoreSeasonal(userId: string, key: SeasonalKey, now: Date): Promise<boolean> {
    const result = await this.c.seasonGrants.updateOne(
      { userId, code: key.code, seasonId: key.seasonId, revokedAt: { $ne: null } },
      { $set: { revokedAt: null, updatedAt: now } },
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
   * «Показано»: две независимые атомарные операции. `codes` — свои видимые несезонные, у которых не показан текущий
   * уровень (update pipeline: `seenLevel` берётся из `level` того же документа в момент записи и монотонен (`$max`);
   * `seenAt` — первый показ; поля v1 ≡ 1); сезонный код здесь совпадений не найдёт. `seasonal` — свои видимые
   * непоказанные сезонные по `(code, seasonId)`. Остальные адреса — без записи.
   */
  async markSeen(
    userId: string,
    codes: readonly AchievementCode[],
    seasonal: readonly SeasonalAchievementRef[],
    now: Date,
  ): Promise<number> {
    let modified = 0;
    const factCodes = codes.filter((code): code is FactAchievementCode => !isSeasonalCode(code));
    if (factCodes.length > 0) modified += await this.markSeenGrants(userId, factCodes, now);
    if (seasonal.length > 0) {
      const result = await this.c.seasonGrants.updateMany(
        {
          userId,
          revokedAt: null,
          seenAt: null,
          $or: seasonal.map(({ code, seasonId }) => ({ code, seasonId })),
        },
        { $set: { seenAt: now, updatedAt: now } },
      );
      modified += result.modifiedCount;
    }
    return modified;
  }

  private async markSeenGrants(
    userId: string,
    codes: readonly FactAchievementCode[],
    now: Date,
  ): Promise<number> {
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

  /** Стирание удалённого аккаунта (ADR-0015): выдачи обеих коллекций, затем маркер; повтор — нули. */
  async deleteAllOf(
    userId: string,
  ): Promise<{ grants: number; seasonGrants: number; syncs: number }> {
    const grants = await this.c.grants.deleteMany({ userId });
    const seasonGrants = await this.c.seasonGrants.deleteMany({ userId });
    const syncs = await this.c.syncs.deleteOne({ _id: userId });
    return {
      grants: grants.deletedCount,
      seasonGrants: seasonGrants.deletedCount,
      syncs: syncs.deletedCount,
    };
  }
}

function grantDoc(
  id: string,
  userId: string,
  code: FactAchievementCode,
  earned: Earned,
  seenAt: Date | null,
  now: Date,
): AchievementGrantDoc {
  return {
    _id: id,
    userId,
    code,
    object: earned.object,
    factAt: earned.factAt,
    grantedAt: now,
    seenAt,
    revokedAt: null,
    level: earned.level,
    seenLevel: seenAt === null ? null : earned.level,
    notifiedLevel: earned.level,
    updatedAt: now,
  };
}

function seasonGrantDoc(
  id: string,
  userId: string,
  earned: SeasonalEarned,
  seenAt: Date | null,
  now: Date,
): AchievementSeasonGrantDoc {
  return {
    _id: id,
    userId,
    code: earned.code,
    seasonId: earned.seasonId,
    factAt: earned.factAt,
    grantedAt: now,
    seenAt,
    revokedAt: null,
    updatedAt: now,
  };
}
