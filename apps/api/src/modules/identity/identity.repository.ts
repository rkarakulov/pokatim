import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter } from 'mongodb';

import { type DbSession, MongoTransactions } from '../../db';
import {
  type ConsentKind,
  type IdentityCollections,
  identityCollections,
  type LinkTokenDoc,
  type SessionRevokedReason,
  type UserDoc,
} from './identity.collection';

export interface UserState {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
}

/** Состояние аккаунта с хешем пароля — только для проверок на сервере. */
export type CheckedCredentials = UserState & { passwordHash: string };

export interface VerificationTokenState {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  supersededAt: Date | null;
  sentAt: Date | null;
}

/** Ссылка сброса пароля: поля — как у ссылки подтверждения. */
export type PasswordResetTokenState = VerificationTokenState;

export interface RegistrationTokenState {
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const userProjection = { _id: 1, email: 1, emailVerifiedAt: 1, deletedAt: 1 } as const;
const credentialsProjection = { ...userProjection, passwordHash: 1 } as const;

// чтение терпит отсутствие поля (`?? null`) — документы, записанные до добавления поля (expand/contract, D8)
const toUserState = (
  doc: Pick<UserDoc, '_id' | 'email' | 'emailVerifiedAt' | 'deletedAt'>,
): UserState => ({
  id: doc._id,
  email: doc.email,
  emailVerifiedAt: doc.emailVerifiedAt ?? null,
  deletedAt: doc.deletedAt ?? null,
});

/**
 * Учётные данные из документа: стёртый после удаления аккаунт (`passwordHash: null`) — «учётных данных нет»: вход, порт
 * панели и подтверждение пароля ведут себя как для неизвестного аккаунта.
 */
const toCredentials = (
  doc: Pick<UserDoc, '_id' | 'email' | 'emailVerifiedAt' | 'deletedAt' | 'passwordHash'> | null,
): CheckedCredentials | undefined =>
  doc && typeof doc.passwordHash === 'string'
    ? { ...toUserState(doc), passwordHash: doc.passwordHash }
    : undefined;

/** Состояние удаления аккаунта для фоновой очистки (ADR-0015). */
export interface DeletionState {
  deletedAt: Date | null;
  erasedAt: Date | null;
  erasureSweptAt: Date | null;
  deletionEmailSentAt: Date | null;
}

const toLinkState = (doc: LinkTokenDoc): VerificationTokenState => ({
  id: doc._id,
  userId: doc.userId,
  expiresAt: doc.expiresAt,
  usedAt: doc.usedAt ?? null,
  supersededAt: doc.supersededAt ?? null,
  sentAt: doc.sentAt ?? null,
});

/**
 * Коллекции ссылок из писем с одинаковыми полями отправки: общий захват отправки (`claimLinkSend`). Подтверждение
 * не нужно уже подтверждённому аккаунту; сброс пароля нужен и неподтверждённому (Q4 слайса 3).
 */
const LINK_KINDS = {
  verification: { collection: 'emailVerificationTokens', unverifiedOnly: true },
  passwordReset: { collection: 'passwordResetTokens', unverifiedOnly: false },
} as const satisfies Record<
  string,
  { collection: 'emailVerificationTokens' | 'passwordResetTokens'; unverifiedOnly: boolean }
>;
export type LinkKind = keyof typeof LINK_KINDS;

type NewLink = { id: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date };

/**
 * Доступ к коллекциям identity (MongoDB, ADR-0007). Транзакцию собирает сервис (`MongoTransactions.run`) и передаёт
 * `session` в каждый метод. Правила сериализации (`pokatim-db.md`):
 * - **R1.** Транзакция, меняющая документы аккаунта, первой операцией вызывает `lockUser`/`lockUserCredentials`
 *   (`$inc: { version: 1 }` документа `users`): две такие транзакции одного аккаунта пишут один документ — у второй
 *   конфликт записи, и `MongoTransactions.run` повторяет её колбэк на свежем снимке и перечитывает состояние.
 * - Вне транзакций — только атомарные операции над одним документом (ротация и отзыв по токену, захват отправки):
 *   если документ держит транзакция, такая запись ждёт её конца и перепроверяет фильтр.
 * - Значения фильтров — только примитивы после zod (хеши, id, даты), не объекты запроса.
 */
@Injectable()
export class IdentityRepository {
  private readonly c: IdentityCollections;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly transactions: MongoTransactions,
  ) {
    this.c = identityCollections(db);
  }

  async findUserByEmail(email: string, session?: DbSession): Promise<UserState | undefined> {
    const doc = await this.c.users.findOne({ email }, { session, projection: userProjection });
    return doc ? toUserState(doc) : undefined;
  }

  /** Хеш пароля и состояние аккаунта для входа; только для сравнения на сервере, наружу не уходит. */
  async findCredentialsByEmail(email: string): Promise<CheckedCredentials | undefined> {
    const doc = await this.c.users.findOne({ email }, { projection: credentialsProjection });
    return toCredentials(doc);
  }

  /**
   * Аккаунт для проверки адреса при регистрации (D-07): открытый адрес или маркер стёртого адреса удалённого аккаунта
   * (`erasedEmailMarker`). Гонки со стиранием нет: адрес и маркер меняются одной атомарной записью.
   */
  async findUserForRegistration(
    email: string,
    marker: string,
    session: DbSession,
  ): Promise<UserState | undefined> {
    const doc = await this.c.users.findOne(
      { email: { $in: [email, marker] } },
      { session, projection: userProjection },
    );
    return doc ? toUserState(doc) : undefined;
  }

  /**
   * Учётные данные аккаунта по id — для порта панели (`IdentityAccounts.accountState`, ADR-0009): одно чтение по
   * `_id`; хеш только для штампа, наружу не уходит.
   */
  async findCredentialsById(userId: string): Promise<CheckedCredentials | undefined> {
    const doc = await this.c.users.findOne({ _id: userId }, { projection: credentialsProjection });
    return toCredentials(doc);
  }

  /** Адреса живых (не удалённых) аккаунтов одним запросом `$in` по `_id` (список сотрудников панели). */
  async findEmailsByIds(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const docs = await this.c.users
      .find({ _id: { $in: [...userIds] }, deletedAt: null }, { projection: { _id: 1, email: 1 } })
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.email]));
  }

  /** Живые (не удалённые) аккаунты из `userIds` — проекция `_id`. */
  async findLiveIds(userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const docs = await this.c.users
      .find({ _id: { $in: [...userIds] }, deletedAt: null }, { projection: { _id: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc._id));
  }

  private async findUser(userId: string, session?: DbSession): Promise<UserState | undefined> {
    const doc = await this.c.users.findOne(
      { _id: userId },
      { session, projection: userProjection },
    );
    return doc ? toUserState(doc) : undefined;
  }

  /**
   * Сериализует мутации одного аккаунта (R1) — **первая** операция каждой такой транзакции: запись `version`
   * конфликтует с другой транзакцией того же аккаунта, проигравшая повторяется после коммита победившей.
   */
  async lockUser(session: DbSession, userId: string): Promise<UserState | undefined> {
    const doc = await this.c.users.findOneAndUpdate(
      { _id: userId },
      { $inc: { version: 1 } },
      { session, returnDocument: 'after', projection: userProjection },
    );
    return doc ? toUserState(doc) : undefined;
  }

  /**
   * `lockUser` с хешем пароля — для входа (R4 слайса 3): под блокировкой аккаунта вход сверяет, что пароль не сменили
   * с момента проверки (сброс, закоммиченный до снимка входа или «в процессе», сессию не выдаёт).
   */
  async lockUserCredentials(
    session: DbSession,
    userId: string,
  ): Promise<CheckedCredentials | undefined> {
    const doc = await this.c.users.findOneAndUpdate(
      { _id: userId },
      { $inc: { version: 1 } },
      { session, returnDocument: 'after', projection: credentialsProjection },
    );
    return toCredentials(doc);
  }

  /** Отметка удаления аккаунта — в транзакции удаления под `lockUserCredentials`; уже удалённый не меняется. */
  async markDeleted(session: DbSession, userId: string, at: Date): Promise<boolean> {
    const result = await this.c.users.updateOne(
      { _id: userId, deletedAt: null },
      { $set: { deletedAt: at } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async updatePasswordHash(session: DbSession, userId: string, passwordHash: string) {
    await this.c.users.updateOne({ _id: userId }, { $set: { passwordHash } }, { session });
  }

  /**
   * Новый аккаунт (id — UUID v7); дубликат адреса — `users_email_unique` (вызывающий переводит в EMAIL_TAKEN).
   * Исключение из R1: `lockUser` нечего блокировать — документа ещё нет; гонку одного адреса сериализует уникальный
   * индекс (конфликт записи в транзакции или `11000` после коммита первой регистрации).
   */
  async insertUser(
    session: DbSession,
    user: { email: string; passwordHash: string; birthDate: string; createdAt: Date },
  ): Promise<string> {
    const id = uuidv7();
    await this.c.users.insertOne(
      { _id: id, ...user, emailVerifiedAt: null, deletedAt: null, version: 0 },
      { session },
    );
    return id;
  }

  async insertConsents(
    session: DbSession,
    userId: string,
    consents: { kind: ConsentKind; version: string }[],
    acceptedAt: Date,
  ): Promise<void> {
    await this.c.userConsents.insertMany(
      consents.map((consent) => ({ _id: uuidv7(), userId, ...consent, acceptedAt })),
      { session },
    );
  }

  async markEmailVerified(session: DbSession, userId: string, at: Date): Promise<void> {
    await this.c.users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: at } }, { session });
  }

  // --- ссылки из писем (подтверждение, сброс пароля) ---

  private async insertLink(kind: LinkKind, session: DbSession, link: NewLink): Promise<void> {
    const { id, ...rest } = link;
    await this.c[LINK_KINDS[kind].collection].insertOne(
      { _id: id, ...rest, usedAt: null, supersededAt: null, sentAt: null, sendClaimedAt: null },
      { session },
    );
  }

  /** Новая ссылка отменяет прежние: активной остаётся одна (частичный уникальный индекс); использованные не трогаем. */
  private async supersedeActiveLinks(
    kind: LinkKind,
    session: DbSession,
    userId: string,
    at: Date,
  ): Promise<void> {
    await this.c[LINK_KINDS[kind].collection].updateMany(
      { userId, usedAt: null, supersededAt: null },
      { $set: { supersededAt: at } },
      { session },
    );
  }

  /** Ссылка и её владелец (в транзакции — в той же `session`); владельца нет — как неизвестная ссылка. */
  private async findLink(
    kind: LinkKind,
    filter: Filter<LinkTokenDoc>,
    session?: DbSession,
  ): Promise<{ token: VerificationTokenState; user: UserState } | undefined> {
    const token = await this.c[LINK_KINDS[kind].collection].findOne(filter, { session });
    if (!token) return undefined;
    const user = await this.findUser(token.userId, session);
    return user ? { token: toLinkState(token), user } : undefined;
  }

  insertVerificationToken(session: DbSession, link: NewLink): Promise<void> {
    return this.insertLink('verification', session, link);
  }

  supersedeActiveVerificationTokens(session: DbSession, userId: string, at: Date): Promise<void> {
    return this.supersedeActiveLinks('verification', session, userId, at);
  }

  findVerificationByHash(tokenHash: string, session?: DbSession) {
    return this.findLink('verification', { tokenHash }, session);
  }

  /**
   * Захват отправки письма со ссылкой (`kind` — коллекция ссылок) с ограниченным сроком (`sendClaimedAt`), отдельно
   * от факта отправки (`sentAt`). Одна реализация для ссылок подтверждения и сброса пароля:
   * - `claimed` — ссылка актуальна, письмо не отправлено, чужого живого захвата нет → отправляем;
   * - `busy` — другой worker держит живой захват → задача уходит на ретрай (если он упал, захват истечёт);
   * - `undefined` — письмо не нужно: уже отправлено, ссылка заменена/использована/истекла, аккаунт удалён
   *   (подтверждение — ещё и уже подтверждён).
   * Захват — один атомарный `findOneAndUpdate` документа ссылки, SMTP — после него. Условие по аккаунту читается
   * отдельно и не атомарно с захватом (R6): аккаунт подтвердили или удалили между чтением и захватом → одно лишнее
   * письмо по ссылке, которая уже ничего не делает («уже подтверждён» / 404). Захват в транзакции с `lockUser`
   * конфликтовал бы с действиями пользователя ради безвредного письма.
   */
  async claimLinkSend(
    kind: LinkKind,
    id: string,
    now: Date,
    leaseMs: number,
  ): Promise<{ status: 'claimed'; id: string; email: string } | { status: 'busy' } | undefined> {
    const { collection, unverifiedOnly } = LINK_KINDS[kind];
    const links = this.c[collection];
    const link = await links.findOne({ _id: id }, { projection: { userId: 1 } });
    if (!link) return undefined;
    const owner = await this.findUser(link.userId);
    if (!owner || owner.deletedAt || (unverifiedOnly && owner.emailVerifiedAt)) return undefined;

    const sendable: Filter<LinkTokenDoc> = {
      _id: id,
      sentAt: null,
      usedAt: null,
      supersededAt: null,
      expiresAt: { $gt: now },
    };
    const leaseExpired = new Date(now.getTime() - leaseMs);
    const claimed = await links.findOneAndUpdate(
      { ...sendable, $or: [{ sendClaimedAt: null }, { sendClaimedAt: { $lte: leaseExpired } }] },
      { $set: { sendClaimedAt: now } },
      { projection: { _id: 1 } },
    );
    if (claimed) return { status: 'claimed', id: claimed._id, email: owner.email };

    const held = await links.findOne(sendable, { projection: { _id: 1 } });
    return held ? { status: 'busy' } : undefined;
  }

  /** SMTP принял письмо: фиксируем отправку и снимаем свой захват. */
  async completeLinkSend(kind: LinkKind, id: string, claimedAt: Date, sentAt: Date) {
    await this.c[LINK_KINDS[kind].collection].updateOne(
      { _id: id, sendClaimedAt: claimedAt },
      { $set: { sentAt, sendClaimedAt: null } },
    );
  }

  /** Сбой SMTP: снимаем свой захват — ретрай задачи отправит письмо заново (та же ссылка). */
  async releaseLinkSend(kind: LinkKind, id: string, claimedAt: Date) {
    await this.c[LINK_KINDS[kind].collection].updateOne(
      { _id: id, sendClaimedAt: claimedAt },
      { $set: { sendClaimedAt: null } },
    );
  }

  async markVerificationUsed(session: DbSession, id: string, at: Date): Promise<void> {
    await this.c.emailVerificationTokens.updateOne(
      { _id: id },
      { $set: { usedAt: at } },
      { session },
    );
  }

  // --- ссылки сброса пароля ---

  insertPasswordResetToken(session: DbSession, link: NewLink): Promise<void> {
    return this.insertLink('passwordReset', session, link);
  }

  /** Новая ссылка отменяет прежние (Q6): активной остаётся одна; использованные не трогаем. */
  supersedeActivePasswordResetTokens(session: DbSession, userId: string, at: Date) {
    return this.supersedeActiveLinks('passwordReset', session, userId, at);
  }

  findPasswordResetByHash(tokenHash: string, session?: DbSession) {
    return this.findLink('passwordReset', { tokenHash }, session);
  }

  /** Использованная ссылка и её владелец — для письма «Пароль изменён» (время смены — `usedAt`). */
  findPasswordResetById(id: string) {
    return this.findLink('passwordReset', { _id: id });
  }

  async markPasswordResetUsed(session: DbSession, id: string, at: Date): Promise<void> {
    await this.c.passwordResetTokens.updateOne({ _id: id }, { $set: { usedAt: at } }, { session });
  }

  // --- токен регистрации ---

  async insertRegistrationToken(
    session: DbSession,
    token: { userId: string; tokenHash: string; createdAt: Date; expiresAt: Date },
  ): Promise<void> {
    await this.c.registrationTokens.insertOne(
      { _id: uuidv7(), ...token, consumedAt: null },
      { session },
    );
  }

  async findRegistrationByHash(
    tokenHash: string,
  ): Promise<{ token: RegistrationTokenState; user: UserState } | undefined> {
    const token = await this.c.registrationTokens.findOne({ tokenHash });
    if (!token) return undefined;
    const user = await this.findUser(token.userId);
    if (!user) return undefined;
    const { userId, expiresAt } = token;
    return { token: { userId, expiresAt, consumedAt: token.consumedAt ?? null }, user };
  }

  /** Скользящий TTL: живой и не обменянный токен регистрации продлевается до срока новой ссылки. */
  async extendRegistrationToken(
    session: DbSession,
    userId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    await this.c.registrationTokens.updateOne(
      { userId, consumedAt: null, expiresAt: { $gt: now } },
      { $set: { expiresAt } },
      { session },
    );
  }

  /**
   * Одноразовый обмен на сессию — в транзакции под `lockUser` владельца (подтверждённость e-mail вызывающий берёт из
   * документа `lockUser` вместо прежнего `EXISTS`): условный `findOneAndUpdate` — из параллельных poll проходит ровно
   * один. Возвращает userId, если обмен состоялся.
   */
  async consumeRegistrationToken(
    session: DbSession,
    tokenHash: string,
    now: Date,
  ): Promise<string | undefined> {
    const doc = await this.c.registrationTokens.findOneAndUpdate(
      { tokenHash, consumedAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } },
      { session, projection: { userId: 1 } },
    );
    return doc?.userId;
  }

  // --- сессии ---

  /**
   * Сессия access живая (ADR-0008, `AuthGuard`): `sid` принадлежит `sub`, не отозвана, не истекла по `now`, и
   * пользователь не удалён. Два чтения по `_id` вне транзакции; условия — в фильтре, значения — UUID после zod.
   * Гонка «запрос ↔ отзыв» принята: прошедший проверку до коммита отзыва запрос завершается.
   */
  async findActiveSession(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const session = await this.c.sessions.findOne(
      { _id: sessionId, userId, revokedAt: null, expiresAt: { $gt: now } },
      { projection: { _id: 1 } },
    );
    if (!session) return false;
    const user = await this.c.users.findOne(
      { _id: userId, deletedAt: null },
      { projection: { _id: 1 } },
    );
    return user !== null;
  }

  /** Живые (не отозванные, не истёкшие) сессии пользователя из `sessionIds`. */
  async findLiveSessionIds(
    userId: string,
    sessionIds: readonly string[],
    now: Date,
  ): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const docs = await this.c.sessions
      .find(
        { _id: { $in: [...sessionIds] }, userId, revokedAt: null, expiresAt: { $gt: now } },
        { projection: { _id: 1 } },
      )
      .toArray();
    return new Set(docs.map((doc) => doc._id));
  }

  async insertSession(
    session: DbSession,
    doc: { id: string; userId: string; refreshTokenHash: string; createdAt: Date; expiresAt: Date },
  ): Promise<void> {
    const { id, ...rest } = doc;
    await this.c.sessions.insertOne(
      {
        _id: id,
        ...rest,
        previousRefreshTokenHash: null,
        rotatedAt: null,
        revokedAt: null,
        revokedReason: null,
      },
      { session },
    );
  }

  /**
   * Ротация refresh одним `findOneAndUpdate` с pipeline-обновлением (ADR-0005, R3). Живая (не отозвана, не истекла)
   * сессия принимает текущий refresh или предыдущий в окне повтора (`rotatedAt` позже `now − grace`). Предыдущим
   * становится текущий хеш документа до обновления (`'$refreshTokenHash'` в pipeline): при повторе в окне брошенный
   * текущий токен тоже станет «предыдущим» и вне окна сработает как reuse. Срок скользящий: `now + ttl`, но не дальше
   * `createdAt + absolute`. Значения — только через `$literal`: строка на `$` в pipeline — путь поля.
   * Параллельные ротации одного токена сериализуются на документе с перепроверкой фильтра — проходят ровно две
   * (текущим и затем предыдущим в окне). Отзыв всех сессий (сброс пароля) идёт в транзакции: пока она не
   * закоммичена, ротация ждёт её конца и перепроверяет `revokedAt: null`; ротация, закоммиченная раньше, вызывает
   * конфликт записи — транзакция сброса повторяется и отзывает ротированную сессию.
   * Удалённый пользователь — чтение `users` до ротации; окно между чтением и ротацией закрывает инвариант «удаление
   * аккаунта отзывает все сессии в той же транзакции» (`pokatim-security.md`).
   */
  async rotateSession(rotation: {
    tokenHash: string;
    nextTokenHash: string;
    now: Date;
    graceMs: number;
    ttlMs: number;
    absoluteTtlMs: number;
  }): Promise<{ id: string; userId: string; expiresAt: Date } | undefined> {
    const { tokenHash, now } = rotation;
    const candidate = await this.c.sessions.findOne(
      { $or: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }] },
      { projection: { userId: 1 } },
    );
    if (!candidate) return undefined;
    const owner = await this.findUser(candidate.userId);
    if (!owner || owner.deletedAt) return undefined;

    const graceStart = new Date(now.getTime() - rotation.graceMs);
    const slidingExpiry = new Date(now.getTime() + rotation.ttlMs);
    const doc = await this.c.sessions.findOneAndUpdate(
      {
        _id: candidate._id,
        revokedAt: null,
        expiresAt: { $gt: now },
        $or: [
          { refreshTokenHash: tokenHash },
          { previousRefreshTokenHash: tokenHash, rotatedAt: { $gt: graceStart } },
        ],
      },
      [
        {
          $set: {
            // путь поля: значение документа до обновления
            previousRefreshTokenHash: '$refreshTokenHash',
            refreshTokenHash: { $literal: rotation.nextTokenHash },
            rotatedAt: { $literal: now },
            expiresAt: {
              $min: [
                { $literal: slidingExpiry },
                { $add: ['$createdAt', { $literal: rotation.absoluteTtlMs }] },
              ],
            },
          },
        },
      ],
      { returnDocument: 'after', projection: { userId: 1, expiresAt: 1 } },
    );
    return doc ? { id: doc._id, userId: doc.userId, expiresAt: doc.expiresAt } : undefined;
  }

  /**
   * Reuse detection: предъявлен предыдущий refresh позже окна повтора — токен, вероятно, украден; живая сессия
   * отзывается целиком (Q8: одна сессия). Возвращает id отозванной сессии (для лога), иначе `undefined`.
   */
  async markReuseDetected(
    tokenHash: string,
    now: Date,
    graceMs: number,
  ): Promise<string | undefined> {
    const doc = await this.c.sessions.findOneAndUpdate(
      {
        previousRefreshTokenHash: tokenHash,
        rotatedAt: { $lte: new Date(now.getTime() - graceMs) },
        revokedAt: null,
      },
      { $set: { revokedAt: now, revokedReason: 'reuse_detected' } },
      { projection: { _id: 1 } },
    );
    return doc?._id;
  }

  /**
   * Отзыв сессии по хешу текущего или предыдущего refresh (гонка выхода с ротацией не оставляет живую сессию);
   * уже отозванная не меняется (идемпотентно).
   */
  async revokeSession(tokenHash: string, at: Date, reason: SessionRevokedReason): Promise<void> {
    await this.c.sessions.updateOne(
      {
        $or: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }],
        revokedAt: null,
      },
      { $set: { revokedAt: at, revokedReason: reason } },
    );
  }

  /**
   * Отзыв всех живых сессий пользователя (смена пароля — `password_reset`) по `sessions_user_id_idx`, в транзакции
   * вызывающего. Уже отозванные не меняются. Возвращает число отозванных.
   */
  async revokeAllSessions(
    session: DbSession,
    userId: string,
    at: Date,
    reason: SessionRevokedReason,
  ): Promise<number> {
    const result = await this.c.sessions.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: at, revokedReason: reason } },
      { session },
    );
    return result.modifiedCount;
  }

  /**
   * Новый токен регистрации взамен прежнего (вход неподтверждённого, Q4) — под `lockUser`: прежний перестаёт
   * действовать, срок — заново. Документ у пользователя один (`registration_tokens_user_id_unique`).
   */
  async replaceRegistrationToken(
    session: DbSession,
    token: { userId: string; tokenHash: string; createdAt: Date; expiresAt: Date },
  ): Promise<void> {
    const { userId, tokenHash, createdAt, expiresAt } = token;
    await this.c.registrationTokens.updateOne(
      { userId },
      {
        $set: { tokenHash, createdAt, expiresAt, consumedAt: null },
        $setOnInsert: { _id: uuidv7(), userId },
      },
      { session, upsert: true },
    );
  }

  /**
   * Необратимо гасит токен регистрации (смена пароля, R5 слайса 3): `consumedAt` — тот же признак, что проверяет
   * обмен на сессию, поэтому не проходит и poll, начатый раньше сброса и запомнивший более раннее «сейчас» (срок
   * сравнивается с его временем, признак — нет). Уже обменянный токен не меняется.
   */
  async revokeRegistrationToken(session: DbSession, userId: string, now: Date): Promise<void> {
    await this.c.registrationTokens.updateOne(
      { userId, consumedAt: null },
      { $set: { consumedAt: now } },
      { session },
    );
  }

  // --- стирание удалённого аккаунта (ADR-0015, фоновая очистка) ---

  async deletionState(userId: string): Promise<DeletionState | undefined> {
    const doc = await this.c.users.findOne(
      { _id: userId },
      {
        projection: { deletedAt: 1, erasedAt: 1, erasureSweptAt: 1, deletionEmailSentAt: 1 },
      },
    );
    if (!doc) return undefined;
    return {
      deletedAt: doc.deletedAt ?? null,
      erasedAt: doc.erasedAt ?? null,
      erasureSweptAt: doc.erasureSweptAt ?? null,
      deletionEmailSentAt: doc.deletionEmailSentAt ?? null,
    };
  }

  /**
   * Захват отправки письма «Аккаунт удалён» (как `claimLinkSend`): удалён, не стёрт, письмо не отправлено, чужого
   * живого захвата нет → `claimed` с адресом и временем удаления; живой чужой захват — `busy`; письмо не нужно
   * (отправлено, стёрт, не удалён) — `undefined`. Один атомарный `findOneAndUpdate`, SMTP — после него.
   */
  async claimDeletionEmail(
    userId: string,
    now: Date,
    leaseMs: number,
  ): Promise<
    { status: 'claimed'; email: string; deletedAt: Date } | { status: 'busy' } | undefined
  > {
    const sendable: Filter<UserDoc> = {
      _id: userId,
      deletedAt: { $ne: null },
      erasedAt: null,
      deletionEmailSentAt: null,
    };
    const leaseExpired = new Date(now.getTime() - leaseMs);
    const claimed = await this.c.users.findOneAndUpdate(
      {
        ...sendable,
        $or: [{ deletionEmailClaimedAt: null }, { deletionEmailClaimedAt: { $lte: leaseExpired } }],
      },
      { $set: { deletionEmailClaimedAt: now } },
      { returnDocument: 'after', projection: { email: 1, deletedAt: 1 } },
    );
    if (claimed?.deletedAt) {
      return { status: 'claimed', email: claimed.email, deletedAt: claimed.deletedAt };
    }
    const held = await this.c.users.findOne(sendable, { projection: { _id: 1 } });
    return held ? { status: 'busy' } : undefined;
  }

  /** SMTP принял письмо «Аккаунт удалён»: факт отправки, свой захват снят. */
  async completeDeletionEmail(userId: string, claimedAt: Date, sentAt: Date): Promise<void> {
    await this.c.users.updateOne(
      { _id: userId, deletionEmailClaimedAt: claimedAt },
      { $set: { deletionEmailSentAt: sentAt, deletionEmailClaimedAt: null } },
    );
  }

  /** Сбой SMTP: свой захват снят — ретрай задачи отправит письмо заново. */
  async releaseDeletionEmail(userId: string, claimedAt: Date): Promise<void> {
    await this.c.users.updateOne(
      { _id: userId, deletionEmailClaimedAt: claimedAt },
      { $set: { deletionEmailClaimedAt: null } },
    );
  }

  /** Открытый адрес удалённого и ещё не стёртого аккаунта — источник маркера стирания. */
  async openEmailOfDeleted(userId: string): Promise<string | undefined> {
    const doc = await this.c.users.findOne(
      { _id: userId, deletedAt: { $ne: null }, erasedAt: null },
      { projection: { email: 1 } },
    );
    return doc?.email;
  }

  /**
   * Стирание ПДн удалённого аккаунта одной атомарной записью: `email` → маркер, `birthDate`/`passwordHash` → `null`,
   * `erasedAt`. Условия — в фильтре: удалён, не стёрт, адрес тот же, что дал маркер, и письмо отправлено либо удалён
   * раньше `abandonBefore` (письмо не ушло за срок — стирание без письма, F8). Возвращает, состоялось ли стирание.
   */
  async eraseDeleted(
    userId: string,
    erase: { email: string; marker: string; now: Date; abandonBefore: Date },
  ): Promise<boolean> {
    const result = await this.c.users.updateOne(
      {
        _id: userId,
        email: erase.email,
        deletedAt: { $ne: null },
        erasedAt: null,
        $or: [{ deletionEmailSentAt: { $ne: null } }, { deletedAt: { $lt: erase.abandonBefore } }],
      },
      {
        $set: {
          email: erase.marker,
          birthDate: null,
          passwordHash: null,
          erasedAt: erase.now,
          deletionEmailClaimedAt: null,
        },
      },
    );
    return result.modifiedCount === 1;
  }

  /** Повторный проход очистки удалённого аккаунта завершён. */
  async markErasureSwept(userId: string, at: Date): Promise<void> {
    await this.c.users.updateOne(
      { _id: userId, deletedAt: { $ne: null } },
      { $set: { erasureSweptAt: at } },
    );
  }

  /**
   * Удалённые раньше `deletedBefore` аккаунты без завершённого повторного прохода — по частичному индексу
   * `users_erasure_pending_idx` (миграция 0023): фильтр повторяет его `partialFilterExpression`.
   */
  async pendingSweeps(deletedBefore: Date, limit: number): Promise<string[]> {
    const docs = await this.c.users
      .find(
        { deletedAt: { $type: 'date', $lt: deletedBefore }, erasureSweptAt: { $eq: null } },
        { projection: { _id: 1 } },
      )
      .sort({ deletedAt: 1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  // --- очистка (V-10) ---

  /**
   * Удаляет пачку неподтверждённых аккаунтов, созданных раньше `createdBefore`, со связанными документами (каскад —
   * явный, R4). Каждый аккаунт — своя транзакция: `findOneAndDelete` повторяет условия, а удаление — запись в `users`,
   * которая конфликтует с идущим подтверждением (`lockUser`); после повтора условие не выполняется — только что
   * подтверждённый аккаунт не удаляется. Согласия удаляются как каскад: аккаунт так и не состоялся. Возвращает
   * число удалённых аккаунтов.
   */
  async deleteUnverifiedBatch(createdBefore: Date, limit: number): Promise<number> {
    const unverifiedAndStale: Filter<UserDoc> = {
      emailVerifiedAt: null,
      deletedAt: null,
      createdAt: { $lt: createdBefore },
    };
    const candidates = await this.c.users
      .find(unverifiedAndStale, { projection: { _id: 1 } })
      .limit(limit)
      .toArray();
    let deleted = 0;
    for (const { _id: userId } of candidates) {
      const removed = await this.transactions.run(async (session) => {
        // исключение из R1: первая операция — сама запись в документ users (удаление с условиями в фильтре)
        const user = await this.c.users.findOneAndDelete(
          { _id: userId, ...unverifiedAndStale },
          { session, projection: { _id: 1 } },
        );
        if (!user) return false;
        const byUser = { userId };
        await this.c.userConsents.deleteMany(byUser, { session });
        await this.c.emailVerificationTokens.deleteMany(byUser, { session });
        await this.c.passwordResetTokens.deleteMany(byUser, { session });
        await this.c.registrationTokens.deleteMany(byUser, { session });
        await this.c.sessions.deleteMany(byUser, { session });
        return true;
      });
      if (removed) deleted += 1;
    }
    return deleted;
  }
}
