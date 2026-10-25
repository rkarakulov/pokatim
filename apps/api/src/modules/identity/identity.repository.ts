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
  async findCredentialsByEmail(
    email: string,
  ): Promise<(UserState & { passwordHash: string }) | undefined> {
    const doc = await this.c.users.findOne({ email }, { projection: credentialsProjection });
    return doc ? { ...toUserState(doc), passwordHash: doc.passwordHash } : undefined;
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
  ): Promise<(UserState & { passwordHash: string }) | undefined> {
    const doc = await this.c.users.findOneAndUpdate(
      { _id: userId },
      { $inc: { version: 1 } },
      { session, returnDocument: 'after', projection: credentialsProjection },
    );
    return doc ? { ...toUserState(doc), passwordHash: doc.passwordHash } : undefined;
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
