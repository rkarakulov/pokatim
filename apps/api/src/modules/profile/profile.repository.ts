import { Inject, Injectable } from '@nestjs/common';
import type { AppThemeId, ProfileReportReason, RideReason } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
import { isPublicProfile } from './profile.policy';
import type { PublicRiderCard, RouteRideRiders } from './rider-names.port';
import {
  PROFILE_COLLECTIONS,
  type ProfileConsentEventDoc,
  type ProfileDoc,
} from './profile.collection';

/**
 * Поля профиля для `ProfileView` (rider-profile: + клуб, аватар, публичный id; user-theme: + тема;
 * profile-moderation-followups: + срок запрета загрузки фото).
 */
export type ProfileViewDoc = Pick<
  ProfileDoc,
  | 'rideReasons'
  | 'publicName'
  | 'showNameInResults'
  | 'club'
  | 'avatarId'
  | 'publicId'
  | 'themeId'
  | 'avatarBlockedUntil'
  | 'showRouteRides'
>;
const VIEW_PROJECTION = {
  _id: 0,
  rideReasons: 1,
  publicName: 1,
  showNameInResults: 1,
  club: 1,
  avatarId: 1,
  publicId: 1,
  themeId: 1,
  avatarBlockedUntil: 1,
  showRouteRides: 1,
} as const;

/** Поля профиля для панели модерации (profile-moderation): подпись Q2, клуб, фото, счётчики жалоб. */
export type ProfileModerationDoc = Pick<
  ProfileDoc,
  | '_id'
  | 'publicName'
  | 'showNameInResults'
  | 'club'
  | 'avatarId'
  | 'openReportCount'
  | 'reportRevision'
  | 'lastReportAt'
  | 'openReasons'
  | 'avatarResetsAt'
  | 'avatarBlockedUntil'
>;
const MODERATION_PROJECTION = {
  publicName: 1,
  showNameInResults: 1,
  club: 1,
  avatarId: 1,
  openReportCount: 1,
  reportRevision: 1,
  lastReportAt: 1,
  openReasons: 1,
  avatarResetsAt: 1,
  avatarBlockedUntil: 1,
} as const;

/** Позиция keyset очереди жалоб: время последней жалобы и `_id` последнего профиля страницы. */
export interface ReportQueuePosition {
  at: Date;
  id: string;
}

/** Итог условного сброса модератором: сброшено, сбрасывать нечего или профиля нет. */
export type ResetOutcome = 'reset' | 'empty' | 'not_found';

/** Закрытие всех открытых жалоб профиля той же операцией (profile-moderation, + причины — followups RC-F1). */
const CLOSE_REPORTS = { openReportCount: 0, openReasons: [] as ProfileReportReason[] };
/** Ревизия сбросов модератором (ревью pass 2) — `$inc` в условной записи сброса; номер этого сброса — прежний + 1. */
const NEXT_RESET = { resetSeq: 1 } as const;
const resetSeqAfter = (before: { resetSeq?: number }) => (before.resetSeq ?? 0) + 1;

/**
 * Поля документа при upsert без ответа опроса (как у шага устройств): прежние значения или пустые. `publicId` не
 * создаётся (его выдаёт только запись имени и согласия).
 */
const KEEP_PROFILE_FIELDS = {
  rideReasons: { $ifNull: ['$rideReasons', { $literal: [] }] },
  surveyCompletedAt: { $ifNull: ['$surveyCompletedAt', null] },
  publicName: { $ifNull: ['$publicName', null] },
  showNameInResults: { $ifNull: ['$showNameInResults', false] },
  club: { $ifNull: ['$club', null] },
  publicId: { $ifNull: ['$publicId', null] },
  showRouteRides: { $ifNull: ['$showRouteRides', false] },
} as const;

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
  async findProfile(userId: string, session?: DbSession): Promise<ProfileViewDoc | null> {
    return this.profiles.findOne({ _id: userId }, { session, projection: VIEW_PROJECTION });
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
    patch: {
      publicName?: string | null;
      showNameInResults?: boolean;
      club?: string | null;
      showRouteRides?: boolean;
    },
    publicIdCandidate: string,
    now: Date,
  ): Promise<ProfileDoc> {
    const doc = await this.profiles.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            ...KEEP_PROFILE_FIELDS,
            publicName:
              patch.publicName === undefined
                ? KEEP_PROFILE_FIELDS.publicName
                : { $literal: patch.publicName },
            showNameInResults:
              patch.showNameInResults === undefined
                ? KEEP_PROFILE_FIELDS.showNameInResults
                : { $literal: patch.showNameInResults },
            club: patch.club === undefined ? KEEP_PROFILE_FIELDS.club : { $literal: patch.club },
            showRouteRides:
              patch.showRouteRides === undefined
                ? KEEP_PROFILE_FIELDS.showRouteRides
                : { $literal: patch.showRouteRides },
            updatedAt: { $literal: now },
          },
        },
        {
          // rider-profile (R-3): id публичного профиля — один раз, при первом «имя + согласие» (второй этап видит
          // значения первого); потом не меняется, отзыв согласия его не стирает
          $set: {
            publicId: {
              $ifNull: [
                '$publicId',
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $type: '$publicName' }, 'string'] },
                        { $eq: ['$showNameInResults', true] },
                      ],
                    },
                    { $literal: publicIdCandidate },
                    null,
                  ],
                },
              ],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', session },
    );
    // upsert с `returnDocument: 'after'` документ возвращает всегда
    if (!doc) throw new Error('profile upsert returned no document');
    return doc;
  }

  /**
   * Новый аватар (rider-profile) — в транзакции замены: upsert по `_id` (документа нет — создаётся без ответа опроса),
   * ответ — документ после записи. Прежний `avatarId` вызывающий прочитал в той же транзакции до записи.
   */
  async setAvatar(
    session: DbSession,
    userId: string,
    avatarId: string,
    now: Date,
  ): Promise<ProfileViewDoc> {
    const doc = await this.profiles.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            ...KEEP_PROFILE_FIELDS,
            avatarId: { $literal: avatarId },
            updatedAt: { $literal: now },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', session, projection: VIEW_PROJECTION },
    );
    if (!doc) throw new Error('profile upsert returned no document');
    return doc;
  }

  /**
   * Личная тема (user-theme, `PUT /v1/profile/theme`): одна атомарная операция вне транзакции — upsert по `_id`
   * (pipeline, значение — `$literal` после zod), ответ — view после записи. Документа нет — создаётся без ответа опроса
   * (как у шага устройств), остальные поля не трогаются. Гонка двух первых upsert — duplicate key на `_id_` (повтор — у
   * сервиса).
   */
  async setTheme(userId: string, themeId: AppThemeId, now: Date): Promise<ProfileViewDoc> {
    const doc = await this.profiles.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            ...KEEP_PROFILE_FIELDS,
            themeId: { $literal: themeId },
            updatedAt: { $literal: now },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', projection: VIEW_PROJECTION },
    );
    if (!doc) throw new Error('profile upsert returned no document');
    return doc;
  }

  /** Тема пользователя для порта `RIDER_THEMES`; нет документа или выбора — `null`. */
  async findTheme(userId: string): Promise<AppThemeId | null> {
    const doc = await this.profiles.findOne({ _id: userId }, { projection: { themeId: 1 } });
    return doc?.themeId ?? null;
  }

  /**
   * Удаление фото (rider-profile) — в транзакции: `avatarId: null` (документ не создаётся), ответ — документ **до**
   * записи (прежний `avatarId` для удаления байтов); документа нет — `null`.
   */
  async clearAvatar(session: DbSession, userId: string, now: Date): Promise<ProfileViewDoc | null> {
    return this.profiles.findOneAndUpdate(
      { _id: userId },
      { $set: { avatarId: null, updatedAt: now } },
      { session, returnDocument: 'before', projection: VIEW_PROJECTION },
    );
  }

  /**
   * Публичный профиль по id (порт `RIDER_PROFILES`, rider-profile): имя и согласие — в фильтре (индекс
   * `profiles_public_id_unique`). Нет, отозвано или имени нет — `null`.
   */
  async findPublic(
    publicId: string,
  ): Promise<Pick<ProfileDoc, '_id' | 'publicName' | 'club' | 'avatarId'> | null> {
    return this.profiles.findOne(
      { publicId, showNameInResults: true, publicName: { $type: 'string' } },
      { projection: { publicName: 1, club: 1, avatarId: 1 } },
    );
  }

  /** Событие журнала согласий (append-only: только вставка) — в транзакции `PATCH` вместе с документом профиля. */
  async insertConsentEvent(session: DbSession, doc: ProfileConsentEventDoc): Promise<void> {
    await this.consentEvents.insertOne(doc, { session });
  }

  /**
   * Сброс публичного имени модератором (profile-02, D5) — в транзакции действия панели: **первой** операцией —
   * условная запись (имя есть) в документ профиля; согласие не трогается; открытые жалобы закрываются тем же действием
   * (`openReportCount: 0`, profile-moderation). Ответ — документ **до** записи: был ли профиль публичен (имя было
   * строкой — фильтр, значит по согласию) и id фото для перевыпуска (RC-A2 (b)). Не совпало — `empty` или `not_found`.
   * Прежнее имя наружу не возвращается.
   */
  async resetPublicName(
    session: DbSession,
    userId: string,
    now: Date,
  ): Promise<{
    outcome: ResetOutcome;
    avatarId: string | null;
    wasPublic: boolean;
    seq: number;
  }> {
    const before = await this.profiles.findOneAndUpdate(
      { _id: userId, publicName: { $type: 'string' } },
      { $set: { publicName: null, ...CLOSE_REPORTS, updatedAt: now }, $inc: NEXT_RESET },
      {
        session,
        returnDocument: 'before',
        projection: { showNameInResults: 1, avatarId: 1, resetSeq: 1 },
      },
    );
    if (before) {
      return {
        outcome: 'reset',
        avatarId: before.avatarId ?? null,
        wasPublic: before.showNameInResults === true,
        seq: resetSeqAfter(before),
      };
    }
    return {
      outcome: await this.missOutcome(session, userId),
      avatarId: null,
      wasPublic: false,
      seq: 0,
    };
  }

  /**
   * Сброс фото модератором (profile-moderation) — первая запись транзакции: условие «фото есть», `avatarId: null` и
   * закрытие жалоб. Ответ — прежний id фото (для удаления документа), история сбросов и срок запрета
   * (profile-moderation-followups, RC-F7: новый срок считает `avatarResetBan`, пишет `recordAvatarReset`) или итог
   * промаха.
   */
  async resetAvatar(
    session: DbSession,
    userId: string,
    now: Date,
  ): Promise<{
    outcome: ResetOutcome;
    avatarId: string | null;
    resets: Date[];
    blockedUntil: Date | null;
    seq: number;
  }> {
    const before = await this.profiles.findOneAndUpdate(
      { _id: userId, avatarId: { $type: 'string' } },
      { $set: { avatarId: null, ...CLOSE_REPORTS, updatedAt: now }, $inc: NEXT_RESET },
      {
        session,
        returnDocument: 'before',
        projection: { avatarId: 1, avatarResetsAt: 1, avatarBlockedUntil: 1, resetSeq: 1 },
      },
    );
    if (before) {
      return {
        outcome: 'reset',
        avatarId: before.avatarId ?? null,
        resets: before.avatarResetsAt ?? [],
        blockedUntil: before.avatarBlockedUntil ?? null,
        seq: resetSeqAfter(before),
      };
    }
    return {
      outcome: await this.missOutcome(session, userId),
      avatarId: null,
      resets: [],
      blockedUntil: null,
      seq: 0,
    };
  }

  /**
   * История сбросов фото и срок запрета (profile-moderation-followups, RC-F7) — вторая запись транзакции сброса фото,
   * после `resetAvatar` того же документа (чужая запись между ними невозможна — документ уже записан транзакцией).
   */
  async recordAvatarReset(
    session: DbSession,
    userId: string,
    resets: Date[],
    blockedUntil: Date | null,
  ): Promise<void> {
    await this.profiles.updateOne(
      { _id: userId },
      { $set: { avatarResetsAt: resets, avatarBlockedUntil: blockedUntil } },
      { session },
    );
  }

  /**
   * «Снять запрет» (profile-moderation-followups) — первая запись транзакции: условие «запрет действует»
   * (`avatarBlockedUntil > now`), `avatarBlockedUntil: null`; история сбросов не очищается. `none` — запрета нет или
   * истёк, `not_found` — профиля нет.
   */
  async unblockAvatar(
    session: DbSession,
    userId: string,
    now: Date,
  ): Promise<'unblocked' | 'none' | 'not_found'> {
    const before = await this.profiles.findOneAndUpdate(
      { _id: userId, avatarBlockedUntil: { $gt: now } },
      { $set: { avatarBlockedUntil: null } },
      { session, projection: { _id: 1 } },
    );
    if (before) return 'unblocked';
    return (await this.missOutcome(session, userId)) === 'empty' ? 'none' : 'not_found';
  }

  /** Срок запрета загрузки фото (`ProfileAvatarService.admit`, до слота и тела); нет документа — `null`. */
  async findAvatarBlock(userId: string): Promise<Date | null> {
    const doc = await this.profiles.findOne(
      { _id: userId },
      { projection: { avatarBlockedUntil: 1 } },
    );
    return doc?.avatarBlockedUntil ?? null;
  }

  /** Сброс клуба модератором (profile-moderation) — первая запись транзакции: условие «клуб есть», `club: null`. */
  async resetClub(
    session: DbSession,
    userId: string,
    now: Date,
  ): Promise<{ outcome: ResetOutcome; seq: number }> {
    const before = await this.profiles.findOneAndUpdate(
      { _id: userId, club: { $type: 'string' } },
      { $set: { club: null, ...CLOSE_REPORTS, updatedAt: now }, $inc: NEXT_RESET },
      { session, returnDocument: 'before', projection: { resetSeq: 1 } },
    );
    if (before) return { outcome: 'reset', seq: resetSeqAfter(before) };
    return { outcome: await this.missOutcome(session, userId), seq: 0 };
  }

  /** Условие сброса не совпало: документа нет — `not_found`, есть (сбрасывать нечего) — `empty` без записи. */
  private async missOutcome(session: DbSession, userId: string): Promise<'empty' | 'not_found'> {
    const existing = await this.profiles.findOne(
      { _id: userId },
      { session, projection: { _id: 1 } },
    );
    return existing ? 'empty' : 'not_found';
  }

  /**
   * «Отклонить жалобы» (profile-moderation) — первая запись транзакции: ревизия жалоб та же, что видел модератор, и
   * открытые есть → `openReportCount: 0` (`updatedAt` — время записи райдера — не трогается). `false` — условие не
   * выполнено (пришла жалоба или уже закрыты).
   */
  async clearReports(session: DbSession, userId: string, reportRevision: number): Promise<boolean> {
    const updated = await this.profiles.findOneAndUpdate(
      { _id: userId, reportRevision, openReportCount: { $gt: 0 } },
      { $set: CLOSE_REPORTS },
      { session, projection: { _id: 1 } },
    );
    return updated !== null;
  }

  /**
   * Жалоба (profile-moderation) — **первая** запись транзакции жалобы (конкурирующий сброс пишет тот же документ:
   * write conflict): профиль публичен и не свой → `$inc openReportCount` и `reportRevision` (маркер «Отклонить
   * жалобы»), `$max lastReportAt` (только порядок очереди), `$addToSet openReasons` (очередь по причине,
   * followups RC-F1); `updatedAt` не трогается. Ответ — `_id` цели; `null` — условие не выполнено.
   */
  async recordReport(
    session: DbSession,
    publicId: string,
    reporterUserId: string,
    reason: ProfileReportReason,
    now: Date,
  ): Promise<string | null> {
    const doc = await this.profiles.findOneAndUpdate(
      {
        publicId,
        showNameInResults: true,
        publicName: { $type: 'string' },
        _id: { $ne: reporterUserId },
      },
      {
        $inc: { openReportCount: 1, reportRevision: 1 },
        $max: { lastReportAt: now },
        $addToSet: { openReasons: reason },
      },
      { session, projection: { _id: 1 } },
    );
    return doc?._id ?? null;
  }

  /**
   * Перевыпуск id фото (RC-A2 (b)) — в транзакции записи профиля: прежний id → новый (или `null`, если документа фото
   * уже нет). Условие — прежний id: параллельная замена фото не перезаписывается.
   */
  async replaceAvatarId(
    session: DbSession,
    userId: string,
    oldId: string,
    newId: string | null,
    now: Date,
  ): Promise<void> {
    await this.profiles.updateOne(
      { _id: userId, avatarId: oldId },
      { $set: { avatarId: newId, updatedAt: now } },
      { session },
    );
  }

  /** Профиль для карточки панели (profile-moderation); `null` — документа нет. */
  findForModeration(userId: string, session?: DbSession): Promise<ProfileModerationDoc | null> {
    return this.profiles.findOne({ _id: userId }, { session, projection: MODERATION_PROJECTION });
  }

  /**
   * Очередь жалоб панели (profile-moderation): профили с открытыми жалобами, новые жалобы сверху. Запрос содержит
   * условие частичного индекса `profiles_report_queue_idx`, план зафиксирован `hint`; keyset по `(lastReportAt, _id)`.
   * С причиной (followups RC-F1) — условие `openReasons` и индекс `profiles_report_reason_queue_idx` (тот же порядок).
   */
  reportQueue(
    after: ReportQueuePosition | null,
    limit: number,
    reason?: ProfileReportReason,
  ): Promise<ProfileModerationDoc[]> {
    const and: Filter<ProfileDoc>[] = [{ openReportCount: { $gt: 0 } }];
    if (reason) and.push({ openReasons: reason });
    if (after) {
      and.push({
        $or: [
          { lastReportAt: { $lt: after.at } },
          { lastReportAt: after.at, _id: { $lt: after.id } },
        ],
      });
    }
    return this.profiles
      .find({ $and: and }, { projection: MODERATION_PROJECTION })
      .sort({ lastReportAt: -1, _id: -1 })
      .hint(reason ? 'profiles_report_reason_queue_idx' : 'profiles_report_queue_idx')
      .limit(limit)
      .toArray();
  }

  /** Размер очереди жалоб (admin-overview, «Обзор» панели) — то же условие и индекс, что у `reportQueue`. */
  /**
   * Страница профилей с именем или клубом по `_id` ↑ (разовая выборка служебных подписей, `ReservedRiderLines`): только
   * `_id`, `publicName`, `club`. Скан коллекции по `_id` — команда сервера, не HTTP.
   */
  linesPage(afterId: string | null, limit: number) {
    return this.profiles
      .find(
        {
          ...(afterId === null ? {} : { _id: { $gt: afterId } }),
          $or: [{ publicName: { $type: 'string' } }, { club: { $type: 'string' } }],
        },
        { projection: { _id: 1, publicName: 1, club: 1 }, sort: { _id: 1 }, limit },
      )
      .toArray();
  }

  countReportQueue(): Promise<number> {
    return this.profiles.countDocuments(
      { openReportCount: { $gt: 0 } },
      { hint: 'profiles_report_queue_idx' },
    );
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

  /**
   * Публичные райдеры строк таблиц (порт `RIDER_NAMES.publicRiders`, rider-links-in-tables): условие — как у
   * `findPublicNames` (в фильтре); наружу — имя, `publicId` и id фото. Один запрос по `_id`.
   */
  async findPublicRiders(userIds: readonly string[]): Promise<Map<string, PublicRiderCard>> {
    const docs = await this.profiles
      .find(
        { _id: { $in: [...userIds] }, showNameInResults: true, publicName: { $type: 'string' } },
        { projection: { publicName: 1, publicId: 1, avatarId: 1 } },
      )
      .toArray();
    return new Map(
      docs.map((doc) => [
        doc._id,
        {
          name: doc.publicName as string,
          publicId: doc.publicId ?? null,
          avatarId: doc.avatarId ?? null,
        },
      ]),
    );
  }

  /**
   * Райдеры с согласием на показ заездов в таблицах маршрутов (route-rides-04, порт `RIDER_NAMES.routeRideRiders`):
   * согласие — в фильтре запроса, без кэша. Карточка (имя, ссылка, фото) — только у публичных (`isPublicProfile`,
   * P1/R4), как у `findPublicRiders`.
   */
  async findRouteRideRiders(userIds: readonly string[]): Promise<RouteRideRiders> {
    const docs = await this.profiles
      .find(
        { _id: { $in: [...userIds] }, showRouteRides: true },
        { projection: { publicName: 1, showNameInResults: 1, publicId: 1, avatarId: 1 } },
      )
      .toArray();
    const cards = new Map<string, PublicRiderCard>();
    for (const doc of docs) {
      if (!isPublicProfile(doc)) continue;
      cards.set(doc._id, {
        name: doc.publicName as string,
        publicId: doc.publicId ?? null,
        avatarId: doc.avatarId ?? null,
      });
    }
    return { shares: new Set(docs.map((doc) => doc._id)), cards };
  }

  /**
   * Имена авторов маршрутов каталога (routes-06, порт `RIDER_NAMES.attributionNames`): только наличие имени — согласие
   * на подпись даёт заявка маршрута (`publication.showAuthorName`, 8.1 RC-2), не `showNameInResults`.
   */
  async findAttributionNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const docs = await this.profiles
      .find(
        { _id: { $in: [...userIds] }, publicName: { $type: 'string' } },
        {
          projection: { publicName: 1 },
        },
      )
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.publicName as string]));
  }

  /**
   * Удаление документа профиля — стирание удалённого аккаунта (`ProfileErasure`, ADR-0015). Только `profiles`: журнал
   * согласий (`profile_consent_events`) — append-only и хранится (A9). Нет документа — no-op.
   */
  async deleteProfile(userId: string): Promise<boolean> {
    const result = await this.profiles.deleteOne({ _id: userId });
    return result.deletedCount === 1;
  }
}
