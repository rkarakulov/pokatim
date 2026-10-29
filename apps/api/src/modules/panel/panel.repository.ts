import { Inject, Injectable } from '@nestjs/common';
import type { AuditAction, PanelRole } from '@pokatim/contracts';
import { isDuplicateKey, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type PanelAuditDoc,
  type PanelCollections,
  panelCollections,
  type PanelMemberDoc,
  type PanelRecoveryCodeDoc,
  type PanelSessionDoc,
  type PanelSessionRevokedReason,
  type PanelSignInChallengeDoc,
  type PanelTotpDoc,
  type PanelTrustedDeviceDoc,
} from './panel.collection';

export type NewPanelSession = Omit<PanelSessionDoc, 'revokedAt' | 'revokedReason'>;
export type NewSignInChallenge = Omit<PanelSignInChallengeDoc, 'attempts'>;

/** Фильтры журнала — только примитивы после zod (`AuditQuery`). */
export interface AuditFilter {
  before?: string;
  action?: AuditAction;
  actorUserId?: string;
  targetUserId?: string;
  subjectId?: string;
}

/**
 * Единственный писатель коллекций панели (ADR-0009). Правила сериализации (`pokatim-db.md`):
 * - транзакция, меняющая члена команды, первой операцией вызывает `lockMember` (`$inc version`); если меняется набор
 *   активных администраторов — ещё раньше `lockAdmins` (`$inc version` документа `panel_meta.admins`, R7): условие
 *   «останется ли админ» — по другим документам, без записи в общий документ MongoDB write skew не ловит;
 * - документы identity в транзакциях панели не пишутся — `lockUser` не нужен;
 * - журнал `panel_audit` — append-only: только `insertOne` (тест-сторож `panel.repository.test.ts`);
 * - значения фильтров — только примитивы после zod (id, хеши, enum-ы, даты).
 */
@Injectable()
export class PanelRepository {
  private readonly c: PanelCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = panelCollections(db);
  }

  // --- члены команды ---

  /**
   * Замок набора активных администраторов (R7) — первая операция транзакции, которая может изменить этот набор.
   * `upsert`: документ создаёт миграция, но и без него замок работает (гонку вставки ловит `_id`).
   */
  async lockAdmins(session: DbSession): Promise<void> {
    await this.c.meta.updateOne(
      { _id: 'admins' },
      { $inc: { version: 1 } },
      { session, upsert: true },
    );
  }

  /** Сериализует изменения одного члена команды: запись `version`; `undefined` — документа нет. */
  async lockMember(session: DbSession, userId: string): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOneAndUpdate(
      { _id: userId },
      { $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
    return doc ?? undefined;
  }

  /** Новый член команды; гонку двух выдач одному пользователю ловит `_id_` (вызывающий повторяет транзакцию). */
  async insertMember(
    session: DbSession,
    member: { userId: string; role: PanelRole; displayName: string; grantedAt: Date },
  ): Promise<PanelMemberDoc> {
    const doc: PanelMemberDoc = {
      _id: member.userId,
      role: member.role,
      status: 'active',
      displayName: member.displayName,
      grantedAt: member.grantedAt,
      revokedAt: null,
      version: 0,
    };
    await this.c.members.insertOne(doc, { session });
    return doc;
  }

  /** Повторная активация снятого члена с новой ролью — после `lockMember`. */
  async reactivateMember(
    session: DbSession,
    member: { userId: string; role: PanelRole; displayName: string; grantedAt: Date },
  ): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOneAndUpdate(
      { _id: member.userId },
      {
        $set: {
          role: member.role,
          status: 'active',
          displayName: member.displayName,
          grantedAt: member.grantedAt,
          revokedAt: null,
        },
      },
      { session, returnDocument: 'after' },
    );
    return doc ?? undefined;
  }

  async setRole(
    session: DbSession,
    userId: string,
    role: PanelRole,
  ): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOneAndUpdate(
      { _id: userId, status: 'active' },
      { $set: { role } },
      { session, returnDocument: 'after' },
    );
    return doc ?? undefined;
  }

  async revokeMember(
    session: DbSession,
    userId: string,
    at: Date,
  ): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOneAndUpdate(
      { _id: userId, status: 'active' },
      { $set: { status: 'revoked', revokedAt: at } },
      { session, returnDocument: 'after' },
    );
    return doc ?? undefined;
  }

  /** Активные администраторы — в транзакции под `lockAdmins` (индекс `panel_members_role_status_idx`). */
  countActiveAdmins(session: DbSession): Promise<number> {
    return this.c.members.countDocuments({ role: 'admin', status: 'active' }, { session });
  }

  /** Член команды в снимке транзакции (без записи) — решить, нужен ли `lockAdmins`, до `lockMember`. */
  async findMember(session: DbSession, userId: string): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOne({ _id: userId }, { session });
    return doc ?? undefined;
  }

  /** Активный член команды — гард и вход в панель (одно чтение по `_id`). */
  async findActiveMember(userId: string): Promise<PanelMemberDoc | undefined> {
    const doc = await this.c.members.findOne({ _id: userId, status: 'active' });
    return doc ?? undefined;
  }

  /** Список «Сотрудники»: новые выдачи сверху, `limit + 1` — признак обрезки у вызывающего. */
  listMembers(limit: number): Promise<PanelMemberDoc[]> {
    return this.c.members.find({}).sort({ grantedAt: -1, _id: 1 }).limit(limit).toArray();
  }

  /** Члены по id (любой статус) — ответ после изменения. */
  listMembersByIds(userIds: readonly string[]): Promise<PanelMemberDoc[]> {
    return this.c.members.find({ _id: { $in: [...userIds] } }).toArray();
  }

  /** Имена членов (в том числе снятых) для журнала. */
  async displayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const docs = await this.c.members
      .find({ _id: { $in: [...userIds] } }, { projection: { _id: 1, displayName: 1 } })
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.displayName]));
  }

  // --- сессии ---

  async insertSession(session: DbSession, doc: NewPanelSession): Promise<void> {
    await this.c.sessions.insertOne({ ...doc, revokedAt: null, revokedReason: null }, { session });
  }

  /** Живая сессия по хешу токена: не отозвана, не истекла по простою и абсолютному сроку на `now`. */
  async findLiveSession(tokenHash: string, now: Date): Promise<PanelSessionDoc | undefined> {
    const doc = await this.c.sessions.findOne({
      tokenHash,
      revokedAt: null,
      idleExpiresAt: { $gt: now },
      expiresAt: { $gt: now },
    });
    return doc ?? undefined;
  }

  /**
   * Продление простоя — условный `updateOne` не чаще раза в `intervalMs`: `idleExpiresAt = min(now + idle, expiresAt)`
   * (pipeline, значения — через `$literal`). Отозванная сессия не продлевается.
   */
  async touchSession(id: string, now: Date, idleMs: number, intervalMs: number): Promise<void> {
    await this.c.sessions.updateOne(
      { _id: id, revokedAt: null, lastSeenAt: { $lt: new Date(now.getTime() - intervalMs) } },
      [
        {
          $set: {
            lastSeenAt: { $literal: now },
            idleExpiresAt: {
              $min: [{ $literal: new Date(now.getTime() + idleMs) }, '$expiresAt'],
            },
          },
        },
      ],
    );
  }

  /** Отзыв одной сессии (идемпотентно: отозванная не меняется). */
  async revokeSession(
    filter: { id: string } | { tokenHash: string },
    at: Date,
    reason: PanelSessionRevokedReason,
    session?: DbSession,
  ): Promise<boolean> {
    const query: Filter<PanelSessionDoc> =
      'id' in filter
        ? { _id: filter.id, revokedAt: null }
        : { tokenHash: filter.tokenHash, revokedAt: null };
    const result = await this.c.sessions.updateOne(
      query,
      { $set: { revokedAt: at, revokedReason: reason } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Отзыв всех живых сессий панели пользователя — в транзакции снятия роли. */
  async revokeAllSessions(
    session: DbSession,
    userId: string,
    at: Date,
    reason: PanelSessionRevokedReason,
  ): Promise<number> {
    const result = await this.c.sessions.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: at, revokedReason: reason } },
      { session },
    );
    return result.modifiedCount;
  }

  // --- 2FA (ADR-0024) ---

  async findTotp(userId: string, session?: DbSession): Promise<PanelTotpDoc | undefined> {
    const doc = await this.c.totp.findOne({ _id: userId }, { session });
    return doc ?? undefined;
  }

  /** 2FA подключена — `Set` userId (колонка «2FA» списка «Сотрудники»). */
  async totpEnabledOf(userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const docs = await this.c.totp
      .find({ _id: { $in: [...userIds] }, status: 'active' }, { projection: { _id: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc._id));
  }

  /**
   * Начать подключение: новый `pending` секрет (заменяет прежний незавершённый). Активную 2FA не трогает — `false`
   * (гонку двух стартов при активной ловит `_id`: upsert по фильтру `status ≠ active` пытается вставить дубль).
   */
  async startTotpSetup(
    userId: string,
    secretEnc: string,
    epoch: string,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.c.totp.updateOne(
        { _id: userId, status: { $ne: 'active' } },
        {
          $set: {
            status: 'pending',
            secretEnc,
            lastUsedStep: null,
            recoveryCodes: [],
            enabledAt: null,
            epoch,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      return true;
    } catch (error) {
      if (isDuplicateKey(error, '_id_')) return false;
      throw error;
    }
  }

  /** Подтверждение подключения: только тот же `pending` секрет (условное обновление — двойное подтверждение одно). */
  async activateTotp(
    session: DbSession,
    userId: string,
    update: { secretEnc: string; step: number; recoveryHashes: string[]; now: Date },
  ): Promise<boolean> {
    const result = await this.c.totp.updateOne(
      { _id: userId, status: 'pending', secretEnc: update.secretEnc },
      {
        $set: {
          status: 'active',
          lastUsedStep: update.step,
          recoveryCodes: update.recoveryHashes.map((hash) => ({ hash, usedAt: null })),
          enabledAt: update.now,
          updatedAt: update.now,
        },
      },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Принять шаг TOTP: только больше записанного (повтор кода — `false`). */
  async acceptTotpStep(
    userId: string,
    step: number,
    now: Date,
    session?: DbSession,
  ): Promise<boolean> {
    const result = await this.c.totp.updateOne(
      {
        _id: userId,
        status: 'active',
        $or: [{ lastUsedStep: null }, { lastUsedStep: { $lt: step } }],
      },
      { $set: { lastUsedStep: step, updatedAt: now } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Погасить код восстановления (условный `$set usedAt`): погашенный или чужой — `false`. */
  async useRecoveryCode(
    session: DbSession,
    userId: string,
    hash: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.totp.updateOne(
      { _id: userId, status: 'active', recoveryCodes: { $elemMatch: { hash, usedAt: null } } },
      { $set: { 'recoveryCodes.$.usedAt': now, updatedAt: now } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async replaceRecoveryCodes(
    session: DbSession,
    userId: string,
    hashes: string[],
    now: Date,
  ): Promise<boolean> {
    const codes: PanelRecoveryCodeDoc[] = hashes.map((hash) => ({ hash, usedAt: null }));
    const result = await this.c.totp.updateOne(
      { _id: userId, status: 'active' },
      { $set: { recoveryCodes: codes, updatedAt: now } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Удалить 2FA (отключение, сброс); `status` — только активную. */
  async deleteTotp(session: DbSession, userId: string, status?: 'active'): Promise<boolean> {
    const result = await this.c.totp.deleteOne(status ? { _id: userId, status } : { _id: userId }, {
      session,
    });
    return result.deletedCount === 1;
  }

  async insertChallenge(doc: NewSignInChallenge): Promise<void> {
    await this.c.challenges.insertOne({ ...doc, attempts: 0 });
  }

  /** Живой вызов: не истёк на `now`, неверных кодов меньше `maxAttempts`. */
  async findLiveChallenge(
    tokenHash: string,
    now: Date,
    maxAttempts: number,
  ): Promise<PanelSignInChallengeDoc | undefined> {
    const doc = await this.c.challenges.findOne({
      tokenHash,
      expiresAt: { $gt: now },
      attempts: { $lt: maxAttempts },
    });
    return doc ?? undefined;
  }

  /** Неверный код: `attempts + 1`; исчерпанный вызов удаляется. */
  async failChallenge(id: string, maxAttempts: number): Promise<void> {
    const doc = await this.c.challenges.findOneAndUpdate(
      { _id: id },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (doc && doc.attempts >= maxAttempts) await this.c.challenges.deleteOne({ _id: id });
  }

  /** Погасить вызов атомарно (в транзакции входа): уже погашенный — `false`. */
  async consumeChallenge(session: DbSession, id: string): Promise<boolean> {
    const result = await this.c.challenges.deleteOne({ _id: id }, { session });
    return result.deletedCount === 1;
  }

  /** Новое доверенное устройство; сверх `max` у сотрудника — старые вытесняются. */
  async insertTrustedDevice(
    session: DbSession,
    doc: PanelTrustedDeviceDoc,
    max: number,
  ): Promise<void> {
    await this.c.devices.insertOne(doc, { session });
    const stale = await this.c.devices
      .find({ userId: doc.userId }, { session, projection: { _id: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .skip(max)
      .toArray();
    if (stale.length > 0) {
      await this.c.devices.deleteMany({ _id: { $in: stale.map((d) => d._id) } }, { session });
    }
  }

  /** Живое устройство сотрудника по хешу токена (штамп и эпоху сверяет вызывающий). */
  async findLiveTrustedDevice(
    tokenHash: string,
    userId: string,
    now: Date,
  ): Promise<PanelTrustedDeviceDoc | undefined> {
    const doc = await this.c.devices.findOne({ tokenHash, userId, expiresAt: { $gt: now } });
    return doc ?? undefined;
  }

  async deleteTrustedDevices(session: DbSession, userId: string): Promise<number> {
    const result = await this.c.devices.deleteMany({ userId }, { session });
    return result.deletedCount;
  }

  // --- журнал (append-only) ---

  /** Единственная запись в журнал — вставка в транзакции действия (через `PanelAudit`). */
  async insertAudit(session: DbSession, doc: PanelAuditDoc): Promise<void> {
    await this.c.audit.insertOne(doc, { session });
  }

  /** Страница журнала: `_id` UUID v7 растёт со временем — новые сверху, курсор — `_id < before`. */
  listAudit(filter: AuditFilter, limit: number): Promise<PanelAuditDoc[]> {
    const query: Filter<PanelAuditDoc> = {};
    if (filter.before) query._id = { $lt: filter.before };
    if (filter.action) query.action = filter.action;
    if (filter.actorUserId) query['actor.userId'] = filter.actorUserId;
    if (filter.targetUserId) query.targetUserId = filter.targetUserId;
    if (filter.subjectId) query['subject.id'] = filter.subjectId;
    return this.c.audit.find(query).sort({ _id: -1 }).limit(limit).toArray();
  }
}
