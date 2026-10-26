import { Inject, Injectable } from '@nestjs/common';
import type { RideReason } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  PROFILE_COLLECTIONS,
  type ProfileConsentEventDoc,
  type ProfileDoc,
} from './profile.collection';

/**
 * Единственный писатель `profiles` и `profile_consent_events`. Опрос и шаг устройств — одна атомарная операция над
 * одним документом вне транзакции. `PATCH /v1/profile` (имя и согласие) и сброс имени модератором — транзакции
 * (profile-02): чтение и запись **одного** документа профиля, событие согласия или журнал панели; документы аккаунта
 * identity не меняются — `lockUser` не нужен (R1 касается транзакций, меняющих документы аккаунта). Значения
 * фильтров — только `userId` из проверенного access/пути после zod и коды enum.
 */
@Injectable()
export class ProfileRepository {
  private readonly profiles: Collection<ProfileDoc>;
  private readonly consentEvents: Collection<ProfileConsentEventDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.profiles = db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
    this.consentEvents = db.collection<ProfileConsentEventDoc>(PROFILE_COLLECTIONS.consentEvents);
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

  /**
   * Профиль для `GET /v1/profile` и прежний флаг согласия в транзакции `PATCH`; `null` — документа нет. Поля до
   * этого слайса могут отсутствовать.
   */
  async findProfile(
    userId: string,
    session?: DbSession,
  ): Promise<Pick<ProfileDoc, 'rideReasons' | 'publicName' | 'showNameInResults'> | null> {
    return this.profiles.findOne(
      { _id: userId },
      { session, projection: { _id: 0, rideReasons: 1, publicName: 1, showNameInResults: 1 } },
    );
  }

  /**
   * Имя и согласие (`PATCH /v1/profile`, RC-5/RC-6): одна операция — upsert по `_id` (pipeline, значения — `$literal`),
   * ответ — документ после записи. Ключа нет в `patch` — поле не меняется. Документа нет — создаётся без ответа опроса
   * (как у шага устройств). `devicesStepCompletedAt` не трогается, `updatedAt` — всегда. В транзакции `PATCH`
   * (profile-02). Гонка двух первых upsert — duplicate key на `_id_` (повтор всей транзакции — у сервиса).
   */
  async updatePublicName(
    session: DbSession,
    userId: string,
    patch: { publicName?: string | null; showNameInResults?: boolean },
    now: Date,
  ): Promise<ProfileDoc> {
    const doc = await this.profiles.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            rideReasons: { $ifNull: ['$rideReasons', { $literal: [] }] },
            surveyCompletedAt: { $ifNull: ['$surveyCompletedAt', null] },
            publicName:
              patch.publicName === undefined
                ? { $ifNull: ['$publicName', null] }
                : { $literal: patch.publicName },
            showNameInResults:
              patch.showNameInResults === undefined
                ? { $ifNull: ['$showNameInResults', false] }
                : { $literal: patch.showNameInResults },
            updatedAt: { $literal: now },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', session },
    );
    // upsert с `returnDocument: 'after'` документ возвращает всегда
    if (!doc) throw new Error('profile upsert returned no document');
    return doc;
  }

  /** Событие журнала согласий (append-only: только вставка) — в транзакции `PATCH` вместе с документом профиля. */
  async insertConsentEvent(session: DbSession, doc: ProfileConsentEventDoc): Promise<void> {
    await this.consentEvents.insertOne(doc, { session });
  }

  /**
   * Сброс публичного имени модератором (profile-02, D5) — в транзакции действия панели: **первой** операцией —
   * условная запись (имя есть) в документ профиля; согласие не трогается. Не совпало — чтение `_id`: документа нет —
   * `not_found`, есть (имени уже нет) — `empty` без записи. Прежнее имя наружу не возвращается.
   */
  async resetPublicName(
    session: DbSession,
    userId: string,
    now: Date,
  ): Promise<'reset' | 'empty' | 'not_found'> {
    const updated = await this.profiles.findOneAndUpdate(
      { _id: userId, publicName: { $type: 'string' } },
      { $set: { publicName: null, updatedAt: now } },
      { session, projection: { _id: 1 } },
    );
    if (updated) return 'reset';
    const existing = await this.profiles.findOne(
      { _id: userId },
      { session, projection: { _id: 1 } },
    );
    return existing ? 'empty' : 'not_found';
  }

  /**
   * Публичные имена для таблиц результатов (порт `RIDER_NAMES`): согласие и наличие имени — в фильтре, не в коде.
   * Один запрос по `_id` (индекс `_id`), только `publicName`.
   */
  async findPublicNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const docs = await this.profiles
      .find(
        { _id: { $in: [...userIds] }, showNameInResults: true, publicName: { $type: 'string' } },
        { projection: { publicName: 1 } },
      )
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.publicName as string]));
  }
}
