import { RegisterResponse, Session, SignInResponse } from '@pokatim/contracts';
import { Collection, MongoServerError } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  collections,
  confirm,
  confirmPasswordReset,
  gate,
  holdTransaction,
  latestResetToken,
  register,
  requestPasswordReset,
  untilBlocked,
  userIdByEmail,
  validRegistration,
  writeWaiting,
} from '../../../test/identity';
import { IdentityRepository } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { sha256 } from './tokens';
import { VerificationService } from './verification.service';

/**
 * Гонки MongoDB, которых в PostgreSQL не было или которые устроены иначе (R9, S2): сброс ↔ вход и сброс ↔ ротация
 * в обоих порядках, ротация ↔ выход, регистрация одного адреса, повтор колбэка регистрации (R12).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
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

const { email: EMAIL, password: OLD_PASSWORD } = validRegistration();
const NEW_PASSWORD = 'brand-new-password';
const REFRESH = '/v1/auth/session/refresh';
const SIGN_OUT = '/v1/auth/session/sign-out';

const repository = () => h.app.get(IdentityRepository, { strict: false });
const signIn = (password = OLD_PASSWORD) =>
  call(
    h,
    'POST',
    '/v1/auth/session/sign-in',
    { email: EMAIL, password },
    { 'x-forwarded-for': '203.0.113.50' },
  );
const refresh = (token: string) => call(h, 'POST', REFRESH, { refreshToken: token });

async function verifiedAccount(): Promise<void> {
  await register(h);
  await confirm(h, await activeLinkToken(h));
}

async function nativeSession(): Promise<string> {
  const body = SignInResponse.parse((await signIn()).body);
  if (body.state !== 'signedIn') throw new Error('expected signedIn');
  return Session.parse(body.session).refreshToken;
}

describe('вход ↔ сброс пароля (R2, ворота)', () => {
  it('сброс завершён между проверкой пароля и lockUserCredentials — 401, сессий нет', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const target = repository();
    const lock = target.lockUserCredentials.bind(target);
    const paused = gate();
    vi.spyOn(target, 'lockUserCredentials').mockImplementationOnce(async (session, userId) => {
      await paused.wait();
      return lock(session, userId);
    });

    const signing = signIn();
    await paused.reached; // старый пароль уже проверен argon2
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(200);
    paused.open();

    const res = await signing;
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });
});

describe('сброс пароля ↔ ротация refresh', () => {
  it('(а) сброс «в процессе» уже отозвал сессии — ротация ждёт его коммита и получает 401', async () => {
    await verifiedAccount();
    const token = await nativeSession();
    const userId = await userIdByEmail(h);
    const reset = await holdTransaction(h, async (session) => {
      const db = collections(h);
      await db.users.updateOne({ _id: userId }, { $inc: { version: 1 } }, { session });
      await db.sessions.updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: h.clock.now(), revokedReason: 'password_reset' } },
        { session },
      );
    });

    const rotating = refresh(token);
    await untilBlocked(rotating, writeWaiting(h, 'sessions'));
    await reset.commit();

    expect((await rotating).status).toBe(401);
    const row = await collections(h).sessions.findOne({ userId });
    expect(row).toMatchObject({ revokedReason: 'password_reset', refreshTokenHash: sha256(token) });
  });

  it('(б) ротация между снимком сброса и отзывом — сброс повторяется и отзывает ротированную сессию', async () => {
    await verifiedAccount();
    const token = await nativeSession();
    await requestPasswordReset(h, EMAIL);
    const link = await latestResetToken(h);
    const target = repository();
    const lockUser = target.lockUser.bind(target);
    const paused = gate();
    const lock = vi.spyOn(target, 'lockUser').mockImplementationOnce(async (session, userId) => {
      const user = await lockUser(session, userId);
      await paused.wait(); // снимок транзакции сброса взят, сессии ещё не отозваны
      return user;
    });

    const resetting = confirmPasswordReset(h, link, NEW_PASSWORD);
    await paused.reached;
    const rotated = await refresh(token);
    expect(rotated.status).toBe(200);
    paused.open();

    expect((await resetting).status).toBe(200);
    expect(lock.mock.calls.length).toBeGreaterThanOrEqual(2); // конфликт записи — колбэк повторён
    const next = Session.parse(rotated.body).refreshToken;
    expect((await refresh(next)).status).toBe(401);
    const row = await collections(h).sessions.findOne({ refreshTokenHash: sha256(next) });
    expect(row).toMatchObject({ revokedReason: 'password_reset' });
  });
});

describe('ротация ↔ выход', () => {
  it('выход между проверкой пользователя и атомарной ротацией — ротация 401, сессия отозвана (signed_out)', async () => {
    await verifiedAccount();
    const token = await nativeSession();
    // ворота на атомарном findOneAndUpdate ротации: кандидат и пользователь уже прочитаны
    const original = Collection.prototype.findOneAndUpdate;
    const paused = gate();
    let gated = false;
    vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementation(function (
      this: Collection,
      ...args: unknown[]
    ) {
      if (!gated && this.collectionName === 'sessions') {
        gated = true;
        return paused.wait().then(() => Reflect.apply(original, this, args) as unknown);
      }
      return Reflect.apply(original, this, args) as unknown;
    } as never);

    const rotating = refresh(token);
    await paused.reached;
    expect((await call(h, 'POST', SIGN_OUT, { refreshToken: token })).status).toBe(204);
    paused.open();

    expect((await rotating).status).toBe(401);
    const [row] = await collections(h).sessions.find().toArray();
    expect(row).toMatchObject({ revokedReason: 'signed_out', refreshTokenHash: sha256(token) });
  });

  it('выход предыдущим токеном после ротации — сессия отозвана, выданный ротацией токен не действует', async () => {
    await verifiedAccount();
    const token = await nativeSession();
    const rotated = await refresh(token);
    expect(rotated.status).toBe(200);

    expect((await call(h, 'POST', SIGN_OUT, { refreshToken: token })).status).toBe(204);

    const [row] = await collections(h).sessions.find().toArray();
    expect(row).toMatchObject({ revokedReason: 'signed_out' });
    expect((await refresh(Session.parse(rotated.body).refreshToken)).status).toBe(401);
  });
});

describe('регистрация', () => {
  it('один адрес ×5 параллельно — один 201, остальные 409 EMAIL_TAKEN (конфликт записи или дубликат ключа)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => register(h)));

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      expect(res.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    }
    expect(await collections(h).users.countDocuments()).toBe(1);
    expect(await collections(h).userConsents.countDocuments()).toBe(2);
  });

  it('повтор колбэка транзакции (транзиентный отказ) — 201; лимит письма списан с нового id, ключ прежнего — сирота (R12)', async () => {
    const verification = h.app.get(VerificationService, { strict: false });
    const take = verification.takeResendAllowance.bind(verification);
    const firstIds: string[] = [];
    const allowance = vi
      .spyOn(verification, 'takeResendAllowance')
      .mockImplementationOnce(async (userId, now) => {
        await take(userId, now);
        firstIds.push(userId);
        const conflict = new MongoServerError({ errmsg: 'WriteConflict (test)', code: 112 });
        conflict.addErrorLabel('TransientTransactionError');
        throw conflict;
      });

    const res = await register(h);

    expect(res.status).toBe(201);
    expect(RegisterResponse.parse(res.body).email).toBe(EMAIL);
    expect(allowance).toHaveBeenCalledTimes(2);
    const userId = await userIdByEmail(h);
    expect(firstIds).toHaveLength(1);
    expect(firstIds[0]).not.toBe(userId);
    // первая попытка откатилась целиком: один аккаунт, одна ссылка
    expect(await collections(h).users.countDocuments()).toBe(1);
    expect(await collections(h).emailVerificationTokens.countDocuments()).toBe(1);
    expect(await h.redis.exists(`rl:verify-resend:${userId}`)).toBe(1);
    expect(await h.redis.exists(`rl:verify-resend:${firstIds[0]}`)).toBe(1);
    // повтор письма раньше паузы — 429: лимит действует по ключу состоявшегося аккаунта
    h.clock.advance(MINUTE / 2);
    const { registrationToken } = RegisterResponse.parse(res.body);
    expect(
      (await call(h, 'POST', '/v1/auth/verification/resend', { registrationToken })).status,
    ).toBe(429);
  });
});

describe('argon2 вне транзакции', () => {
  it('повтор транзакции входа не пересчитывает хеш пароля', async () => {
    await verifiedAccount();
    const verify = vi.spyOn(h.app.get(PasswordHasher, { strict: false }), 'verify');
    const userId = await userIdByEmail(h);
    const holder = await holdTransaction(h, async (session) => {
      await collections(h).users.updateOne({ _id: userId }, { $inc: { version: 1 } }, { session });
    });
    const lock = vi.spyOn(repository(), 'lockUserCredentials');

    const signing = signIn();
    await untilBlocked(signing, async () => lock.mock.calls.length >= 2);
    await holder.commit();

    expect((await signing).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
