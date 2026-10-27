import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { PROFILE_COLLECTIONS } from './profile.collection';
import type { RiderVerifiedProfileDoc } from './verified-profile.collection';

export type VerifiedValues = Pick<
  RiderVerifiedProfileDoc,
  'gender' | 'birthYear' | 'weightKg' | 'heightCm' | 'ftpW'
>;

export type Demographics = Pick<RiderVerifiedProfileDoc, 'gender' | 'birthYear'>;

/**
 * Единственный писатель `rider_verified_profiles` (race-results-07). Конфликт «первая Verified-заявка ↔ правка пола и
 * года райдером» держат две записи одного документа: заявка в своей транзакции **пишет** документ (`lockForEntry`:
 * `demographicsLockedAt ??= now`, `version + 1`), а `PUT` райдера — одна атомарная операция с условием
 * «не зафиксировано или пол и год те же» в фильтре. Одиночная запись во время транзакции ждёт её коммита и
 * перечитывает фильтр; запись, закоммиченная после снимка транзакции, даёт ей WriteConflict — повтор на свежей анкете.
 * Значения фильтров — `userId` из access/пути после zod и значения после схемы.
 */
@Injectable()
export class VerifiedProfileRepository {
  private readonly profiles: Collection<RiderVerifiedProfileDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.profiles = db.collection<RiderVerifiedProfileDoc>(PROFILE_COLLECTIONS.verified);
  }

  find(userId: string, session?: DbSession): Promise<RiderVerifiedProfileDoc | null> {
    return this.profiles.findOne({ _id: userId }, { session });
  }

  /**
   * Анкета райдера целиком: пол и год — только пока не зафиксированы или те же (условие в фильтре). `false` —
   * документа нет **или** пол/год зафиксированы и отличаются (различает вызывающий чтением).
   */
  async updateOwn(
    userId: string,
    values: VerifiedValues,
    consent: { at: Date; version: string },
    now: Date,
  ): Promise<boolean> {
    const result = await this.profiles.updateOne(
      {
        _id: userId,
        $or: [
          { demographicsLockedAt: null },
          { gender: values.gender, birthYear: values.birthYear },
        ],
      },
      {
        $set: {
          ...values,
          consentAt: consent.at,
          consentVersion: consent.version,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
    );
    return result.matchedCount === 1;
  }

  /** Первая анкета; гонка двух первых — duplicate key на `_id_` (повтор — у сервиса). */
  async insertOwn(doc: RiderVerifiedProfileDoc): Promise<void> {
    await this.profiles.insertOne(doc);
  }

  /**
   * Фиксация пола и года в транзакции Verified-заявки (шаг 4 `EntriesService.enter`): **настоящая запись всегда**
   * (`version + 1`), `demographicsLockedAt ??= now`. Нет анкеты — `null`. Пол и год — из документа после записи.
   */
  async lockForEntry(session: DbSession, userId: string, now: Date): Promise<Demographics | null> {
    return this.profiles.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            demographicsLockedAt: { $ifNull: ['$demographicsLockedAt', { $literal: now }] },
            version: { $add: ['$version', 1] },
          },
        },
      ],
      {
        session,
        returnDocument: 'after',
        projection: { _id: 0, gender: 1, birthYear: 1 },
      },
    );
  }

  /**
   * Правка пола и/или года командой (панель) — первой операцией транзакции: только присланные поля, только если хоть
   * одно отличается (условие в фильтре). Документ **до** записи; `null` — нет документа или значения те же.
   */
  updateDemographics(
    session: DbSession,
    userId: string,
    patch: Partial<Demographics>,
    now: Date,
  ): Promise<RiderVerifiedProfileDoc | null> {
    const differs = Object.entries(patch).map(([field, value]) => ({ [field]: { $ne: value } }));
    return this.profiles.findOneAndUpdate(
      { _id: userId, $or: differs },
      { $set: { ...patch, updatedAt: now }, $inc: { version: 1 } },
      { session, returnDocument: 'before' },
    );
  }

  /** Стирание анкеты удалённого аккаунта (идемпотентно). */
  async delete(userId: string): Promise<boolean> {
    const result = await this.profiles.deleteOne({ _id: userId });
    return result.deletedCount === 1;
  }
}
