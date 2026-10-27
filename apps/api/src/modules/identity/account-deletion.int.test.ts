import { isDomainError } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, HOUR, MINUTE, type Harness } from '../../../test/harness';
import {
  call,
  collections,
  register,
  requestPasswordReset,
  signUpSession,
  userIdByEmail,
  validRegistration,
} from '../../../test/identity';
import { MongoTransactions } from '../../db';
import { AccountClosure } from './account-closure';
import { AccountErasure, type AccountEraseOptions } from './account-erasure';
import { IdentityAccounts } from './identity-accounts';
import { erasedEmailMarker } from './tokens';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const { email: EMAIL, password: PASSWORD } = validRegistration();
const IP = '203.0.113.9';
const OPTIONS: AccountEraseOptions = { abandonEmailAfterMs: DAY, emailClaimMs: 5 * MINUTE };

/** Удаление аккаунта через порт identity — как сервис `account` (проверка пароля → транзакция `close`). */
async function closeAccount(userId: string, password = PASSWORD) {
  const closure = h.app.get(AccountClosure);
  const hash = await closure.verifyPassword(userId, password, IP);
  return h.app.get(MongoTransactions).run((tx) => closure.close(tx, userId, hash, h.clock.now()));
}

const erasure = () => h.worker.get(AccountErasure);
const signIn = (email: string, password = PASSWORD) =>
  call(h, 'POST', '/v1/auth/session/sign-in', { email, password });

describe('AccountClosure', () => {
  it('закрывает аккаунт: deletedAt, все сессии отозваны с account_deleted, ссылки и токен регистрации погашены', async () => {
    await signUpSession(h);
    await signIn(EMAIL);
    const userId = await userIdByEmail(h);
    await requestPasswordReset(h, EMAIL);

    const result = await closeAccount(userId);

    expect(result).toEqual({ outcome: 'closed', revoked: 2 });
    const c = collections(h);
    expect((await c.users.findOne({ _id: userId }))?.deletedAt).toEqual(h.clock.now());
    const sessions = await c.sessions.find({ userId }).toArray();
    expect(sessions.map((s) => s.revokedReason)).toEqual(['account_deleted', 'account_deleted']);
    expect(await c.passwordResetTokens.countDocuments({ userId, supersededAt: null })).toBe(0);
    expect(
      await c.emailVerificationTokens.countDocuments({ userId, supersededAt: null, usedAt: null }),
    ).toBe(0);
    expect(await c.registrationTokens.countDocuments({ userId, consumedAt: null })).toBe(0);
    // согласия — append-only (A9): не удаляются и не дописываются
    expect(await c.userConsents.countDocuments({ userId })).toBe(2);
  });

  it('неверный пароль — 403 PASSWORD_INCORRECT, аккаунт не тронут', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    const error = await h.app
      .get(AccountClosure)
      .verifyPassword(userId, 'wrong-password', IP)
      .catch((e: unknown) => e);
    expect(isDomainError(error) && [error.code, error.status]).toEqual(['PASSWORD_INCORRECT', 403]);
    expect((await collections(h).users.findOne({ _id: userId }))?.deletedAt).toBeNull();
  });

  it('повторное закрытие — already без изменений; сменённый пароль — changed', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    const closure = h.app.get(AccountClosure);
    const hash = await closure.verifyPassword(userId, PASSWORD, IP);
    const tx = h.app.get(MongoTransactions);
    expect(await tx.run((s) => closure.close(s, userId, `${hash}-changed`, h.clock.now()))).toEqual(
      { outcome: 'changed', revoked: 0 },
    );
    expect((await collections(h).users.findOne({ _id: userId }))?.deletedAt).toBeNull();

    expect((await tx.run((s) => closure.close(s, userId, hash, h.clock.now()))).outcome).toBe(
      'closed',
    );
    expect(await tx.run((s) => closure.close(s, userId, hash, h.clock.now()))).toEqual({
      outcome: 'already',
      revoked: 0,
    });
    // удалённый — 401 уже на проверке пароля
    const error = await closure.verifyPassword(userId, PASSWORD, IP).catch((e: unknown) => e);
    expect(isDomainError(error) && error.status).toBe(401);
  });
});

describe('AccountErasure.notifyAndErase', () => {
  it('письмо «Аккаунт удалён» один раз, затем маркер вместо e-mail, без даты рождения и хеша', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    await closeAccount(userId);
    h.mailer.reset();

    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('erased');
    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('already');

    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]).toMatchObject({ to: EMAIL, subject: 'Аккаунт удалён' });
    const user = await collections(h).users.findOne({ _id: userId });
    expect(user).toMatchObject({
      email: erasedEmailMarker(h.env.EMAIL_TOKEN_SECRET, EMAIL),
      birthDate: null,
      passwordHash: null,
      erasedAt: h.clock.now(),
      deletionEmailSentAt: h.clock.now(),
      deletionEmailClaimedAt: null,
    });
    expect(JSON.stringify(user)).not.toContain('@');
  });

  it('живой аккаунт не трогает (not_deleted): ни письма, ни стирания', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    h.mailer.reset();
    const before = await collections(h).users.findOne({ _id: userId });

    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('not_deleted');

    expect(h.mailer.sent).toHaveLength(0);
    expect(await collections(h).users.findOne({ _id: userId })).toEqual(before);
  });

  it('сбой SMTP — захват снят, бросок; ретрай отправляет одно письмо и стирает', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    await closeAccount(userId);
    h.mailer.reset();
    h.mailer.failNext();

    await expect(erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).rejects.toThrow();
    const failed = await collections(h).users.findOne({ _id: userId });
    expect(failed).toMatchObject({ email: EMAIL, deletionEmailClaimedAt: null });
    expect(failed?.erasedAt ?? null).toBeNull();

    h.clock.advance(MINUTE);
    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('erased');
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('свежий чужой захват — бросок без письма; после истечения захвата — одно письмо', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    await closeAccount(userId);
    h.mailer.reset();
    await collections(h).users.updateOne(
      { _id: userId },
      { $set: { deletionEmailClaimedAt: h.clock.now() } },
    );

    await expect(erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).rejects.toThrow(
      /another worker/,
    );
    expect(h.mailer.sent).toHaveLength(0);
    expect((await collections(h).users.findOne({ _id: userId }))?.email).toBe(EMAIL);

    h.clock.advance(OPTIONS.emailClaimMs);
    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('erased');
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('F8: письмо не ушло за срок — стирание без письма, лог abandoned без e-mail', async () => {
    await signUpSession(h);
    const userId = await userIdByEmail(h);
    await closeAccount(userId);
    h.mailer.reset();
    h.mailer.failNext();
    await expect(erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).rejects.toThrow();

    const warn = vi.spyOn(erasure()['logger'], 'warn');
    h.clock.advance(DAY + HOUR);
    expect(await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS)).toBe('erased');

    expect(h.mailer.sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(`account.deletion_email_abandoned user=${userId}`);
    for (const [message] of warn.mock.calls) expect(String(message)).not.toContain('@');
    expect((await collections(h).users.findOne({ _id: userId }))?.erasedAt).toEqual(h.clock.now());
  });
});

describe('стёртый адрес (AC6, A4)', () => {
  async function deletedAndErased() {
    const session = await signUpSession(h);
    const userId = await userIdByEmail(h);
    await closeAccount(userId);
    return { session, userId };
  }

  it('регистрация на адрес удалённого — 409 EMAIL_UNAVAILABLE до и после стирания', async () => {
    const { userId } = await deletedAndErased();
    const before = await register(h);
    expect([before.status, (before.body as { code: string }).code]).toEqual([
      409,
      'EMAIL_UNAVAILABLE',
    ]);

    await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS);
    const after = await register(h);
    expect([after.status, (after.body as { code: string }).code]).toEqual([
      409,
      'EMAIL_UNAVAILABLE',
    ]);
    // регистр и пробелы адреса не обходят блок: адрес нормализуется до маркера
    expect((await register(h, { email: ' Rider@Example.COM ' })).status).toBe(409);
    // другой адрес регистрируется
    expect((await register(h, { email: 'other@example.com' })).status).toBe(201);
  });

  it('вход по стёртому адресу — тот же ответ, что неизвестному адресу; сброс — нейтрально и без ссылки', async () => {
    const { userId } = await deletedAndErased();
    await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS);
    h.mailer.reset();

    const deleted = await signIn(EMAIL);
    const unknown = await signIn('nobody@example.com');
    expect([deleted.status, deleted.body]).toEqual([unknown.status, unknown.body]);
    expect(deleted.status).toBe(401);

    const reset = await requestPasswordReset(h, EMAIL);
    const resetUnknown = await requestPasswordReset(h, 'nobody@example.com', '198.51.100.2');
    expect([reset.status, reset.body]).toEqual([resetUnknown.status, resetUnknown.body]);
    expect(await collections(h).passwordResetTokens.countDocuments({ userId })).toBe(0);
  });

  it('refresh удалённого — 401; порт панели: стёртый аккаунт неизвестен, адреса нет', async () => {
    const { session, userId } = await deletedAndErased();
    const refreshed = await call(h, 'POST', '/v1/auth/session/refresh', {
      refreshToken: session.refreshToken,
    });
    expect(refreshed.status).toBe(401);

    await erasure().notifyAndErase(userId, h.clock.now(), OPTIONS);
    const accounts = h.app.get(IdentityAccounts);
    expect(await accounts.accountState(userId)).toBeUndefined();
    expect(await accounts.findVerifiedByEmail(EMAIL)).toBeUndefined();
    expect((await accounts.emailsOf([userId])).size).toBe(0);
  });
});

describe('повторный проход: pendingSweeps / markSwept', () => {
  it('только удалённые раньше границы без erasureSweptAt', async () => {
    await signUpSession(h);
    await signUpSession(h, 'live@example.com');
    const deletedId = await userIdByEmail(h);
    await closeAccount(deletedId);
    const boundary = new Date(h.clock.now().getTime() + 1);

    expect(await erasure().pendingSweeps(boundary, 10)).toEqual([deletedId]);
    expect(await erasure().pendingSweeps(h.clock.now(), 10)).toEqual([]);

    await erasure().markSwept(deletedId, h.clock.now());
    expect(await erasure().pendingSweeps(boundary, 10)).toEqual([]);

    const plan = await collections(h)
      .users.find({ deletedAt: { $type: 'date', $lt: boundary }, erasureSweptAt: { $eq: null } })
      .explain('queryPlanner');
    expect(JSON.stringify(plan)).toContain('users_erasure_pending_idx');
  });
});
