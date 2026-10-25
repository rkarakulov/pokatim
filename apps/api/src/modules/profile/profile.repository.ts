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
   * Ответ опроса: upsert по `_id` (pipeline, значения — `$literal`). `surveyCompletedAt` — при первом ответе
   * (документ мог создать шаг устройств — тогда там `null`), `updatedAt` — всегда. Два первых upsert одновременно
   * могут оба не найти документ: проигравший получает duplicate key на `_id_` (повтор — у сервиса).
   */
  async upsertSurvey(userId: string, reasons: RideReason[], now: Date): Promise<void> {
    await this.profiles.updateOne(
      { _id: userId },
      [
        {
          $set: {
            rideReasons: { $literal: reasons },
            updatedAt: { $literal: now },
            surveyCompletedAt: { $ifNull: ['$surveyCompletedAt', { $literal: now }] },
          },
        },
      ],
      { upsert: true },
    );
  }

  /**
   * Шаг «Подключите устройство» пройден: время первого прохождения сохраняется, повтор идемпотентен. Документа нет
   * (порядок шагов сервер не навязывает) — создаётся без ответа опроса.
   */
  async markDevicesStep(userId: string, now: Date): Promise<void> {
    await this.profiles.updateOne(
      { _id: userId },
      [
        {
          $set: {
            devicesStepCompletedAt: { $ifNull: ['$devicesStepCompletedAt', { $literal: now }] },
            rideReasons: { $ifNull: ['$rideReasons', { $literal: [] }] },
            surveyCompletedAt: { $ifNull: ['$surveyCompletedAt', null] },
            updatedAt: { $literal: now },
          },
        },
      ],
      { upsert: true },
    );
  }

  /** Статус онбординга по документу профиля (нет документа — ничего не пройдено). */
  async onboardingFlags(
    userId: string,
  ): Promise<{ surveyCompleted: boolean; devicesStepCompleted: boolean }> {
    const doc = await this.profiles.findOne(
      { _id: userId },
      { projection: { surveyCompletedAt: 1, devicesStepCompletedAt: 1 } },
    );
    return {
      surveyCompleted: (doc?.surveyCompletedAt ?? null) !== null,
      devicesStepCompleted: (doc?.devicesStepCompletedAt ?? null) !== null,
    };
  }

  /** Ответы опроса пользователя; `null` — документа нет (опрос не пройден). */
  async findReasons(userId: string): Promise<RideReason[] | null> {
    const doc = await this.profiles.findOne(
      { _id: userId },
      { projection: { _id: 0, rideReasons: 1 } },
    );
    // документ шага устройств без опроса — опрос не пройден
    return doc?.rideReasons?.length ? doc.rideReasons : null;
  }
}
