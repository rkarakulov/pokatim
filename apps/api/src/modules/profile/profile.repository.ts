import { Inject, Injectable } from '@nestjs/common';
import type { RideReason } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import { PROFILE_COLLECTIONS, type ProfileDoc } from './profile.collection';

/**
 * Единственный писатель `profiles`. Запись — одна атомарная операция над одним документом вне транзакции: документы
 * аккаунта identity не меняются, `lockUser` не нужен (R1 касается транзакций, меняющих документы аккаунта).
 * Значения фильтров — только `userId` из проверенного access и коды enum после zod.
 */
@Injectable()
export class ProfileRepository {
  private readonly profiles: Collection<ProfileDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.profiles = db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
  }

  /**
   * Ответ опроса: upsert по `_id`. `surveyCompletedAt` — только при вставке (первый ответ), `updatedAt` — всегда.
   * Два первых upsert одновременно могут оба не найти документ: проигравший получает duplicate key на `_id_`
   * (повтор — у сервиса).
   */
  async upsertSurvey(userId: string, reasons: RideReason[], now: Date): Promise<void> {
    await this.profiles.updateOne(
      { _id: userId },
      { $set: { rideReasons: reasons, updatedAt: now }, $setOnInsert: { surveyCompletedAt: now } },
      { upsert: true },
    );
  }

  async hasSurvey(userId: string): Promise<boolean> {
    const doc = await this.profiles.findOne({ _id: userId }, { projection: { _id: 1 } });
    return doc !== null;
  }

  /** Ответы опроса пользователя; `null` — документа нет (опрос не пройден). */
  async findReasons(userId: string): Promise<RideReason[] | null> {
    const doc = await this.profiles.findOne(
      { _id: userId },
      { projection: { _id: 0, rideReasons: 1 } },
    );
    return doc?.rideReasons ?? null;
  }
}
