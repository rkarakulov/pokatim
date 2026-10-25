import { Inject, Injectable } from '@nestjs/common';
import type { TrackFailureCode, TrackSource, TrackUploadStatus } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { AnyBulkWriteOperation, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type ActivityDoc,
  type ActivityTrackDoc,
  type TrackSourceRefDoc,
  type TrackUploadDoc,
  type TracksCollections,
  tracksCollections,
} from './tracks.collection';
import { DEDUP_START_WINDOW_MS } from './tracks.policy';

/** Ключ маркера объекта источника. */
export const sourceRefKey = (source: TrackSource, sourceRef: string) => `${source}:${sourceRef}`;

/** Статусы загрузки, которые ещё обрабатываются (задача разбора может её захватить). */
const IN_PROGRESS: TrackUploadStatus[] = ['queued', 'processing'];
/**
 * Отбракованные: исходник хранится 7 дней (Q10). `duplicate` — не отбракованный: у него есть активность, и при
 * удалении основной он становится основным (исходник нужен будущим гонкам и спорам).
 */
const REJECTED: TrackUploadStatus[] = ['failed', 'skipped'];

/**
 * Единственный писатель `track_uploads`, `activities`, `activity_tracks`, `activity_meta` (`pokatim-db.md`):
 * - «в группе дублей одна основная» — условие по другим документам: транзакция, вставляющая или удаляющая
 *   активность, **первой** операцией вызывает `lockUserActivities` (R7, как `lockSchedule`);
 * - изменения статуса загрузки — атомарный `findOneAndUpdate` с ожидаемым статусом в фильтре;
 * - значения фильтров — только примитивы после zod (id, enum-ы, даты).
 */
@Injectable()
export class TracksRepository {
  private readonly c: TracksCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = tracksCollections(db);
  }

  /** Замок активностей пользователя — первая операция транзакции (upsert: документа может ещё не быть). */
  async lockUserActivities(session: DbSession, userId: string): Promise<void> {
    await this.c.meta.updateOne(
      { _id: userId },
      { $inc: { version: 1 } },
      { session, upsert: true },
    );
  }

  // --- загрузки ---

  async findUploadBySha(userId: string, sha256: string): Promise<TrackUploadDoc | undefined> {
    return (await this.c.uploads.findOne({ userId, sha256 })) ?? undefined;
  }

  async findUploadBySourceRef(
    source: TrackSource,
    sourceRef: string,
  ): Promise<TrackUploadDoc | undefined> {
    return (await this.c.uploads.findOne({ source, sourceRef })) ?? undefined;
  }

  async findUpload(id: string, session?: DbSession): Promise<TrackUploadDoc | undefined> {
    return (await this.c.uploads.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Своя загрузка; чужая и неизвестная — `undefined` (404 без различия). */
  async findOwnUpload(userId: string, id: string): Promise<TrackUploadDoc | undefined> {
    return (await this.c.uploads.findOne({ _id: id, userId })) ?? undefined;
  }

  async insertUpload(session: DbSession, doc: TrackUploadDoc): Promise<void> {
    await this.c.uploads.insertOne(doc, { session });
  }

  /** Свои загрузки, новые сверху (`_id` — UUID v7, порядок создания), курсор — `_id` последней. */
  listOwnUploads(userId: string, afterId: string | null, limit: number): Promise<TrackUploadDoc[]> {
    const filter = afterId ? { userId, _id: { $lt: afterId } } : { userId };
    return this.c.uploads.find(filter).sort({ _id: -1 }).limit(limit).toArray();
  }

  /** Загрузки источника пользователя (удаление с отключением). */
  listSourceUploadIds(userId: string, source: TrackSource): Promise<string[]> {
    return this.c.uploads
      .find({ userId, source }, { projection: { _id: 1 } })
      .map((doc) => doc._id)
      .toArray();
  }

  /** Сумма байт исходников, лежащих в хранилище (квота). */
  async storedBytes(): Promise<number> {
    const [row] = await this.c.uploads
      .aggregate<{ total: number }>([
        { $match: { storageKey: { $type: 'string' } } },
        { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
      ])
      .toArray();
    return row?.total ?? 0;
  }

  /**
   * Захват загрузки задачей разбора: только `queued`/`processing` (повтор после падения worker); финальная — `null`
   * (задача ничего не делает).
   */
  claimUpload(id: string, now: Date): Promise<TrackUploadDoc | null> {
    return this.c.uploads.findOneAndUpdate(
      { _id: id, status: { $in: IN_PROGRESS } },
      { $set: { status: 'processing', updatedAt: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
  }

  /** Финальный отказ разбора; только из `processing` (иначе — уже обработана или удалена). */
  async failUpload(id: string, failure: TrackFailureCode, now: Date): Promise<boolean> {
    const result = await this.c.uploads.updateOne(
      { _id: id, status: 'processing' },
      { $set: { status: 'failed', failure, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  // --- активности (в транзакции под lockUserActivities) ---

  /** Кандидаты дубля: активности пользователя со стартом в окне ±180 с. */
  dedupCandidates(session: DbSession, userId: string, startedAt: Date): Promise<ActivityDoc[]> {
    const t = startedAt.getTime();
    return this.c.activities
      .find(
        {
          userId,
          startedAt: {
            $gte: new Date(t - DEDUP_START_WINDOW_MS),
            $lte: new Date(t + DEDUP_START_WINDOW_MS),
          },
        },
        { session },
      )
      .toArray();
  }

  /** Все члены групп с основными `rootIds` (сами основные и их дубли). */
  groupMembers(session: DbSession, userId: string, rootIds: string[]): Promise<ActivityDoc[]> {
    return this.c.activities
      .find(
        { userId, $or: [{ _id: { $in: rootIds } }, { duplicateOf: { $in: rootIds } }] },
        { session },
      )
      .toArray();
  }

  async insertActivity(
    session: DbSession,
    activity: ActivityDoc,
    track: ActivityTrackDoc | null,
  ): Promise<void> {
    await this.c.activities.insertOne(activity, { session });
    if (track) await this.c.tracks.insertOne(track, { session });
  }

  /**
   * Новый состав группы: у основной `duplicateOf = null`, у остальных — id основной; статусы их загрузок —
   * `ready`/`duplicate` (только финальные, не трогает загрузку в процессе).
   */
  async applyGroup(
    session: DbSession,
    members: readonly Pick<ActivityDoc, '_id' | 'uploadId'>[],
    primaryId: string,
    now: Date,
  ): Promise<void> {
    if (members.length === 0) return;
    const activityOps: AnyBulkWriteOperation<ActivityDoc>[] = members.map((member) => ({
      updateOne: {
        filter: { _id: member._id },
        update: { $set: { duplicateOf: member._id === primaryId ? null : primaryId } },
      },
    }));
    await this.c.activities.bulkWrite(activityOps, { session });
    const uploadOps: AnyBulkWriteOperation<TrackUploadDoc>[] = members.map((member) => ({
      updateOne: {
        filter: { _id: member.uploadId, status: { $in: ['ready', 'duplicate', 'processing'] } },
        update: {
          $set: { status: member._id === primaryId ? 'ready' : 'duplicate', updatedAt: now },
        },
      },
    }));
    await this.c.uploads.bulkWrite(uploadOps, { session });
  }

  /** Загрузка разобрана: связь с активностью (статус ставит `applyGroup`). */
  async attachActivity(
    session: DbSession,
    uploadId: string,
    activityId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.uploads.updateOne(
      { _id: uploadId, status: 'processing' },
      { $set: { activityId, failure: null, updatedAt: now } },
      { session },
    );
    return result.matchedCount === 1;
  }

  async findActivityByUpload(
    session: DbSession,
    uploadId: string,
  ): Promise<ActivityDoc | undefined> {
    return (await this.c.activities.findOne({ uploadId }, { session })) ?? undefined;
  }

  /** Сводки активностей по id (список загрузок). */
  activitiesByIds(ids: string[]): Promise<ActivityDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.activities.find({ _id: { $in: ids } }).toArray();
  }

  /** Удаление загрузки с активностью и линией (в транзакции под `lockUserActivities`). */
  async deleteUploadCascade(
    session: DbSession,
    userId: string,
    uploadId: string,
  ): Promise<{ upload: TrackUploadDoc; activity: ActivityDoc | undefined } | undefined> {
    const upload = await this.c.uploads.findOneAndDelete({ _id: uploadId, userId }, { session });
    if (!upload) return undefined;
    const activity =
      (await this.c.activities.findOneAndDelete({ uploadId }, { session })) ?? undefined;
    if (activity) await this.c.tracks.deleteOne({ _id: activity._id }, { session });
    return { upload, activity };
  }

  /** Бывшие дубли удалённой основной (перевыбор основной). */
  duplicatesOf(session: DbSession, primaryId: string): Promise<ActivityDoc[]> {
    return this.c.activities.find({ duplicateOf: primaryId }, { session }).toArray();
  }

  // --- маркер объекта источника (воскрешение удалённого) ---

  /** Пользователь удалял этот объект источника (вне транзакции — ранний отказ до записи файла). */
  async isSourceRefDeleted(key: string, session?: DbSession): Promise<boolean> {
    const doc = await this.c.sourceRefs.findOne({ _id: key }, { session });
    return doc?.state === 'deleted';
  }

  /**
   * Приём объекта источника (в транзакции вставки загрузки): маркер `live`. Удалённый (`deleted`) — upsert пытается
   * вставить тот же `_id` → `11000` на `_id_` (вызывающий отвечает `TrackSourceDeletedError`). Запись в тот же
   * документ, что и удаление, — конкурирующие транзакции конфликтуют.
   */
  async claimSourceRef(session: DbSession, key: string, userId: string, now: Date): Promise<void> {
    await this.c.sourceRefs.updateOne(
      { _id: key, state: 'live' },
      { $set: { updatedAt: now }, $setOnInsert: { userId, state: 'live' } },
      { session, upsert: true },
    );
  }

  /** Удаление загрузки источника: маркер `deleted` (в транзакции удаления). */
  async markSourceRefDeleted(
    session: DbSession,
    key: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    const doc: Omit<TrackSourceRefDoc, '_id'> = { userId, state: 'deleted', updatedAt: now };
    await this.c.sourceRefs.updateOne({ _id: key }, { $set: doc }, { session, upsert: true });
  }

  // --- уборка ---

  /** Отбракованные загрузки с исходником, не менявшиеся с `before`. */
  rejectedWithFile(before: Date, limit: number): Promise<TrackUploadDoc[]> {
    return this.c.uploads
      .find({
        status: { $in: REJECTED },
        updatedAt: { $lt: before },
        storageKey: { $type: 'string' },
      })
      .limit(limit)
      .toArray();
  }

  /** Исходник удалён уборкой: ключ снимается, только если не изменился. */
  async clearStorageKey(id: string, storageKey: string): Promise<void> {
    await this.c.uploads.updateOne({ _id: id, storageKey }, { $set: { storageKey: null } });
  }

  /** Какие из ключей хранилища известны загрузкам (уборка файлов без документа). */
  async knownStorageKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const docs = await this.c.uploads
      .find({ storageKey: { $in: keys } }, { projection: { storageKey: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc.storageKey).filter((key): key is string => key !== null));
  }
}
