import { Inject, Injectable } from '@nestjs/common';
import type { DeviceIssue, DeviceProvider } from '@pokatim/contracts';
import { isDuplicateKey, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type DeviceAccountDoc,
  type DeviceAuditDoc,
  type DeviceConnectionDoc,
  type DeviceConnectionStatus,
  type DeviceImportDoc,
  type DeviceLinkTicketDoc,
  type DevicesCollections,
  devicesCollections,
  LIVE_CONNECTION_STATUSES,
} from './devices.collection';

export type RevokedReason = NonNullable<DeviceConnectionDoc['revokedReason']>;

/**
 * Единственный писатель коллекций `devices` (`pokatim-db.md`):
 * - «одно живое подключение на `(userId, provider)`» держит частичный уникальный индекс, переходы статуса —
 *   атомарный `findOneAndUpdate` с ожидаемым статусом в фильтре (`$inc version`); транзакции сервиса пишут только
 *   документ подключения, журнал и outbox — условий по другим документам нет, замок не нужен;
 * - тикет — одноразовый: `findOneAndDelete` с проверкой срока;
 * - импорт — уникален `(provider, aggWorkoutId)`; завершение — только из `queued` (надгробие `deleted` не
 *   перезаписывается);
 * - `device_audit` — только `insertOne` (тест-сторож `device-audit.test.ts`);
 * - значения фильтров — только примитивы после zod (id, enum-ы, даты).
 */
@Injectable()
export class DevicesRepository {
  private readonly c: DevicesCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = devicesCollections(db);
  }

  // --- пользователь агрегатора ---

  async findAccount(userId: string): Promise<DeviceAccountDoc | undefined> {
    return (await this.c.accounts.findOne({ _id: userId })) ?? undefined;
  }

  /** Вставка; гонка вставок одного пользователя — документ победителя. */
  async insertAccount(doc: DeviceAccountDoc): Promise<DeviceAccountDoc> {
    try {
      await this.c.accounts.insertOne(doc);
      return doc;
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      const existing = await this.findAccount(doc._id);
      if (!existing) throw error;
      return existing;
    }
  }

  // --- подключения ---

  async findConnection(id: string): Promise<DeviceConnectionDoc | undefined> {
    return (await this.c.connections.findOne({ _id: id })) ?? undefined;
  }

  async findLiveConnection(
    userId: string,
    provider: DeviceProvider,
  ): Promise<DeviceConnectionDoc | undefined> {
    return (
      (await this.c.connections.findOne({
        userId,
        provider,
        status: { $in: [...LIVE_CONNECTION_STATUSES] },
      })) ?? undefined
    );
  }

  /** Подключения пользователя, новые сверху (`_id` — UUID v7). */
  listUserConnections(userId: string): Promise<DeviceConnectionDoc[]> {
    return this.c.connections.find({ userId }).sort({ _id: -1 }).limit(50).toArray();
  }

  /** Вставка `pending`; уже есть живое подключение `(userId, provider)` — `false`. */
  async insertConnection(doc: DeviceConnectionDoc): Promise<boolean> {
    try {
      await this.c.connections.insertOne(doc);
      return true;
    } catch (error) {
      if (isDuplicateKey(error, 'device_connections_user_provider_live_unique')) return false;
      throw error;
    }
  }

  /** Повторная авторизация: `pending` (новый тикет) или `active` с `issue: 'reauthorize'` → `pending`. */
  async reopenPending(id: string, pendingUntil: Date): Promise<DeviceConnectionDoc | undefined> {
    return (
      (await this.c.connections.findOneAndUpdate(
        {
          _id: id,
          $or: [{ status: 'pending' }, { status: 'active', issue: 'reauthorize' }],
        },
        { $set: { status: 'pending', pendingUntil }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )) ?? undefined
    );
  }

  async activate(
    session: DbSession,
    id: string,
    userId: string,
    now: Date,
    catchUpUntil: Date,
  ): Promise<DeviceConnectionDoc | undefined> {
    return (
      (await this.c.connections.findOneAndUpdate(
        { _id: id, userId, status: 'pending' },
        {
          $set: {
            status: 'active',
            issue: null,
            pendingUntil: null,
            connectedAt: now,
            catchUpUntil,
            failedImports: 0,
          },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      )) ?? undefined
    );
  }

  /** Перевод в `disconnecting` из ожидаемых статусов (отключение пользователем, чужой тикет). */
  async requestDisconnect(
    session: DbSession,
    id: string,
    from: readonly DeviceConnectionStatus[],
  ): Promise<DeviceConnectionDoc | undefined> {
    return (
      (await this.c.connections.findOneAndUpdate(
        { _id: id, status: { $in: [...from] } },
        { $set: { status: 'disconnecting', pendingUntil: null }, $inc: { version: 1 } },
        { session, returnDocument: 'after' },
      )) ?? undefined
    );
  }

  /**
   * Уборка: истёкший `pending` → `disconnecting` (`revokedReason: 'unconfirmed'`) только для прочитанной версии
   * документа и пока срок истёк — переподключение (новый тикет, `$inc version`) или подтверждение между чтением и
   * переходом не отзываются.
   */
  async expirePending(
    session: DbSession,
    candidate: Pick<DeviceConnectionDoc, '_id' | 'version'>,
    now: Date,
  ): Promise<DeviceConnectionDoc | undefined> {
    return (
      (await this.c.connections.findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'pending',
          version: candidate.version,
          pendingUntil: { $lte: now },
        },
        {
          $set: { status: 'disconnecting', pendingUntil: null, revokedReason: 'unconfirmed' },
          $inc: { version: 1 },
        },
        { session, returnDocument: 'after' },
      )) ?? undefined
    );
  }

  /** Финал отзыва: `revoked` из ожидаемого статуса. */
  async markRevoked(
    session: DbSession | undefined,
    id: string,
    from: DeviceConnectionStatus,
    change: { reason: RevokedReason; revokeFailed: boolean; now: Date },
  ): Promise<boolean> {
    const result = await this.c.connections.updateOne(
      { _id: id, status: from },
      {
        $set: {
          status: 'revoked',
          revokedAt: change.now,
          revokedReason: change.reason,
          revokeFailed: change.revokeFailed,
          issue: change.revokeFailed ? 'revoke_failed' : null,
          pendingUntil: null,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Проблема активного подключения (`sync_failed`, `reauthorize`); `true` — значение изменилось. */
  async setIssue(session: DbSession | undefined, id: string, issue: DeviceIssue): Promise<boolean> {
    const result = await this.c.connections.updateOne(
      { _id: id, status: 'active', issue: { $ne: issue } },
      { $set: { issue }, $inc: { version: 1 } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async clearIssue(id: string, issue: DeviceIssue): Promise<void> {
    await this.c.connections.updateOne(
      { _id: id, status: 'active', issue },
      { $set: { issue: null }, $inc: { version: 1 } },
    );
  }

  async markSynced(id: string, now: Date): Promise<void> {
    await this.c.connections.updateOne(
      { _id: id, status: 'active' },
      { $set: { lastSyncedAt: now } },
    );
  }

  /**
   * Подключение всё ещё `active` той же эпохи (`connectedAt` активации): pull проверяет это перед приёмом заезда —
   * отключение или переподключение во время сетевых ожиданий импорт не продолжает.
   */
  async isActiveEpoch(id: string, connectedAt: Date | null): Promise<boolean> {
    return (
      (await this.c.connections.countDocuments({ _id: id, status: 'active', connectedAt })) === 1
    );
  }

  /** Активные подключения пачками по `_id` (расписание pull, сверка). */
  listActive(afterId: string | null, limit: number): Promise<DeviceConnectionDoc[]> {
    const filter = afterId
      ? { status: 'active' as const, _id: { $gt: afterId } }
      : { status: 'active' as const };
    return this.c.connections.find(filter).sort({ _id: 1 }).limit(limit).toArray();
  }

  listActiveByAggUser(aggUserId: string): Promise<DeviceConnectionDoc[]> {
    return this.c.connections.find({ aggUserId, status: 'active' }).limit(10).toArray();
  }

  /** Неподтверждённые за TTL тикета (`device_connections_status_idx`). */
  listExpiredPending(now: Date, limit: number): Promise<DeviceConnectionDoc[]> {
    return this.c.connections
      .find({ status: 'pending', pendingUntil: { $lt: now } })
      .sort({ pendingUntil: 1 })
      .limit(limit)
      .toArray();
  }

  // --- тикеты ---

  async insertTicket(doc: DeviceLinkTicketDoc): Promise<void> {
    await this.c.tickets.insertOne(doc);
  }

  /** Живой тикет без изменений (callback идемпотентен). */
  async findLiveTicket(hash: string, now: Date): Promise<DeviceLinkTicketDoc | undefined> {
    return (await this.c.tickets.findOne({ _id: hash, expiresAt: { $gt: now } })) ?? undefined;
  }

  /** Одноразовое погашение: два `complete` одного тикета — успех только у одного. */
  async takeTicket(hash: string, now: Date): Promise<DeviceLinkTicketDoc | undefined> {
    return (
      (await this.c.tickets.findOneAndDelete({ _id: hash, expiresAt: { $gt: now } })) ?? undefined
    );
  }

  // --- импорт ---

  async findImport(
    provider: DeviceProvider,
    aggWorkoutId: string,
  ): Promise<DeviceImportDoc | undefined> {
    return (await this.c.imports.findOne({ provider, aggWorkoutId })) ?? undefined;
  }

  /** Новый импорт (`queued`, попытка 1); уже есть — `false`. */
  async insertImport(doc: DeviceImportDoc): Promise<boolean> {
    try {
      await this.c.imports.insertOne(doc);
      return true;
    } catch (error) {
      if (isDuplicateKey(error, 'device_imports_workout_unique')) return false;
      throw error;
    }
  }

  /**
   * Повтор незавершённого импорта: только без загрузки (`uploadId: null` — заезд ещё не создан, удалённый не
   * воскресает), в `queued`/`failed`, пока попыток меньше лимита.
   */
  async claimRetry(
    id: string,
    maxAttempts: number,
    now: Date,
  ): Promise<DeviceImportDoc | undefined> {
    return (
      (await this.c.imports.findOneAndUpdate(
        {
          _id: id,
          status: { $in: ['queued', 'failed'] },
          uploadId: null,
          attempts: { $lt: maxAttempts },
        },
        { $set: { status: 'queued', updatedAt: now }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      )) ?? undefined
    );
  }

  /** Завершение попытки — только из `queued`: надгробие `deleted`, записанное в процессе, остаётся. */
  async finishImport(
    id: string,
    change: {
      status: 'imported' | 'skipped' | 'failed';
      reason: string | null;
      uploadId: string | null;
      now: Date;
    },
  ): Promise<boolean> {
    const result = await this.c.imports.updateOne(
      { _id: id, status: 'queued' },
      {
        $set: {
          status: change.status,
          reason: change.reason,
          uploadId: change.uploadId,
          updatedAt: change.now,
        },
      },
    );
    return result.modifiedCount === 1;
  }

  /** Надгробие удалённой загрузки провайдера: следующий pull тренировку не вернёт. */
  async tombstone(provider: DeviceProvider, aggWorkoutId: string, now: Date): Promise<boolean> {
    const result = await this.c.imports.updateOne(
      { provider, aggWorkoutId, status: { $ne: 'deleted' } },
      { $set: { status: 'deleted', reason: 'upload_deleted', updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  /** Импорты подключения, исчерпавшие попытки. */
  countExhaustedImports(
    userId: string,
    provider: DeviceProvider,
    maxAttempts: number,
  ): Promise<number> {
    return this.c.imports.countDocuments({
      userId,
      provider,
      status: 'failed',
      attempts: { $gte: maxAttempts },
    });
  }

  // --- журнал (append-only) ---

  async insertAudit(session: DbSession | undefined, doc: DeviceAuditDoc): Promise<void> {
    await this.c.audit.insertOne(doc, { session });
  }
}
