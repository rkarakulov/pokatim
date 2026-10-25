import { Logger } from '@nestjs/common';
import {
  RateLimitedDetails,
  RegisterResponse,
  RequestPasswordResetResponse,
  Session,
  SignInResponse,
} from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, HOUR, MINUTE, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  collections,
  confirm,
  confirmPasswordReset,
  describePasswordReset,
  gate,
  holdTransaction,
  latestResetToken,
  outboxEvents,
  poll,
  register,
  requestPasswordReset,
  retried,
  untilBlocked,
  userIdByEmail,
  validRegistration,
} from '../../../test/identity';
import { IDENTITY_POLICY } from './identity.policy';
import { IdentityRepository } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { sha256 } from './tokens';

let h: Harness;
beforeAll(async () => {
  // за прокси (как prod за Caddy): лимиты по IP проверяются разными X-Forwarded-For
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
const SIGN_IN = '/v1/auth/session/sign-in';
const REFRESH = '/v1/auth/session/refresh';

const signIn = (email: string, password: string) =>
  call(h, 'POST', SIGN_IN, { email, password }, { 'x-forwarded-for': '203.0.113.50' });

/** Подтверждённый аккаунт (пароль OLD_PASSWORD). */
async function verifiedAccount(email = EMAIL): Promise<void> {
  await register(h, { email });
  await confirm(h, await activeLinkToken(h, email));
}

/** Native-вход: refresh из тела. */
async function nativeSession(email = EMAIL, password = OLD_PASSWORD): Promise<string> {
  const body = SignInResponse.parse((await signIn(email, password)).body);
  if (body.state !== 'signedIn') throw new Error('expected signedIn');
  return Session.parse(body.session).refreshToken;
}

const hasher = () => h.app.get(PasswordHasher, { strict: false });
const resetRows = () =>
  collections(h).passwordResetTokens.find().sort({ createdAt: 1, _id: 1 }).toArray();
const eventTypes = async () => (await outboxEvents(h)).map((event) => event.type);
const sessionByRefresh = (refresh: string) =>
  collections(h).sessions.findOne({ refreshTokenHash: sha256(refresh) });

describe('POST /v1/auth/password-reset — запрос ссылки (AC1)', () => {
  it('существующий адрес (любой регистр, пробелы) — 200, ссылка на 1 час, событие outbox', async () => {
    await verifiedAccount();

    const res = await requestPasswordReset(h, '  Rider@Example.COM ');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(RequestPasswordResetResponse.parse(res.body)).toEqual({ resendAvailableInSec: 60 });
    const [row] = await resetRows();
    const [user] = await collections(h).users.find().toArray();
    expect(row).toMatchObject({
      userId: user?._id,
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + HOUR),
      usedAt: null,
      supersededAt: null,
    });
    expect(row?.tokenHash).toBe(sha256(await latestResetToken(h)));
    const event = (await outboxEvents(h)).at(-1);
    expect(event?.type).toBe('identity.password-reset-email-requested');
    // в payload — только id ссылки: ни токена, ни e-mail
    expect(event?.payload).toEqual({ passwordResetTokenId: row?._id });
  });

  it('неизвестный и удалённый адрес — тот же 200 побайтно, ни ссылки, ни события', async () => {
    await verifiedAccount();
    await verifiedAccount('gone@example.com');
    await collections(h).users.updateOne(
      { email: 'gone@example.com' },
      { $set: { deletedAt: h.clock.now() } },
    );
    const eventsBefore = await eventTypes();

    const existing = await requestPasswordReset(h, EMAIL, '198.51.100.1');
    const unknown = await requestPasswordReset(h, 'nobody@example.com', '198.51.100.2');
    const deleted = await requestPasswordReset(h, 'gone@example.com', '198.51.100.3');

    for (const res of [existing, unknown, deleted]) expect(res.status).toBe(200);
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(existing.body));
    expect(JSON.stringify(deleted.body)).toBe(JSON.stringify(existing.body));
    expect(await resetRows()).toHaveLength(1);
    expect(await eventTypes()).toEqual([
      ...eventsBefore,
      'identity.password-reset-email-requested',
    ]);
  });

  it('неподтверждённый аккаунт — ссылка выпускается (Q4)', async () => {
    await register(h);
    expect((await requestPasswordReset(h, EMAIL)).status).toBe(200);
    expect(await resetRows()).toHaveLength(1);
  });

  it('тело не по контракту — 400 (неверный e-mail, лишний ключ)', async () => {
    for (const body of [{ email: 'ivan@' }, { email: EMAIL, extra: 1 }, {}]) {
      const res = await call(h, 'POST', '/v1/auth/password-reset', body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});

describe('лимиты запроса (AC2, Q5)', () => {
  const { email: emailLimit, ip: ipLimit } = IDENTITY_POLICY.passwordResetLimits;

  it('второй запрос раньше 60 с — 429 + retryAfterSec, одинаково для несуществующего адреса', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    await requestPasswordReset(h, 'nobody@example.com');
    h.clock.advance(20_000);

    const existing = await requestPasswordReset(h, EMAIL, '198.51.100.9');
    const missing = await requestPasswordReset(h, 'nobody@example.com', '198.51.100.9');

    expect(existing.status).toBe(429);
    expect(existing.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(RateLimitedDetails.parse((existing.body as { details: unknown }).details)).toEqual({
      retryAfterSec: 40,
    });
    expect(missing.body).toEqual(existing.body);
    expect(await resetRows()).toHaveLength(1);
  });

  it(`не больше ${emailLimit.limit} за сутки на e-mail, с разных IP; после паузы — снова`, async () => {
    await verifiedAccount();
    for (let i = 0; i < emailLimit.limit; i += 1) {
      expect((await requestPasswordReset(h, EMAIL, `203.0.113.${i}`)).status).toBe(200);
      h.clock.advance(emailLimit.cooldownSec * 1000);
    }

    const blocked = await requestPasswordReset(h, EMAIL, '203.0.113.200');

    expect(blocked.status).toBe(429);
    expect(await resetRows()).toHaveLength(emailLimit.limit);
  });

  it(`IP: ${ipLimit.limit} запросов в час по разным адресам, дальше 429; отказ по IP не создаёт счётчика e-mail`, async () => {
    for (let i = 0; i < ipLimit.limit; i += 1) {
      expect((await requestPasswordReset(h, `rider${i}@example.com`)).status).toBe(200);
    }
    const blocked = await requestPasswordReset(h, 'other@example.com');

    expect(blocked.status).toBe(429);
    expect(RateLimitedDetails.parse((blocked.body as { details: unknown }).details)).toEqual({
      retryAfterSec: ipLimit.windowSec,
    });
    expect(await h.redis.keys('rl:pwreset-email*')).toHaveLength(ipLimit.limit);
  });

  it('IPv6: адреса одной /64 — один счётчик IP', async () => {
    for (let i = 0; i < ipLimit.limit; i += 1) {
      await requestPasswordReset(h, `rider${i}@example.com`, `2001:db8:1:2::${i + 1}`);
    }
    expect((await requestPasswordReset(h, 'x@example.com', '2001:db8:1:2:ffff::9')).status).toBe(
      429,
    );
    expect((await requestPasswordReset(h, 'x@example.com', '2001:db8:1:3::1')).status).toBe(200);
  });

  it('в Redis — только HMAC-ключи: ни e-mail, ни IP', async () => {
    await requestPasswordReset(h, EMAIL, '198.51.100.77');

    const keys = await h.redis.keys('rl:pwreset-*');
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain('rider');
      expect(key).not.toContain('198.51.100');
    }
  });
});

describe('GET /v1/auth/password-reset/:token — без побочных эффектов (AC3, AC4)', () => {
  const snapshot = async () => ({
    users: await collections(h).users.find().toArray(),
    sessions: await collections(h).sessions.find().toArray(),
    links: await resetRows(),
    events: await eventTypes(),
  });

  it('valid → expired через 1 час; ничего не меняет', async () => {
    await verifiedAccount();
    await nativeSession();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const before = await snapshot();

    const res = await describePasswordReset(h, token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ state: 'valid', email: EMAIL });
    expect(await snapshot()).toEqual(before);

    h.clock.advance(HOUR);
    expect((await describePasswordReset(h, token)).body).toEqual({
      state: 'expired',
      email: EMAIL,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('новая ссылка отменяет прежнюю (Q6): старая — expired и POST 410, новая — valid', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const first = await latestResetToken(h);
    h.clock.advance(MINUTE);
    await requestPasswordReset(h, EMAIL);
    const second = await latestResetToken(h);
    expect(second).not.toBe(first);

    expect((await describePasswordReset(h, first)).body).toEqual({
      state: 'expired',
      email: EMAIL,
    });
    expect((await describePasswordReset(h, second)).body).toEqual({ state: 'valid', email: EMAIL });
    const stale = await confirmPasswordReset(h, first, NEW_PASSWORD);
    expect(stale.status).toBe(410);
    expect(stale.body).toMatchObject({ code: 'LINK_EXPIRED', details: { email: EMAIL } });
  });

  it('used после смены пароля', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    await confirmPasswordReset(h, token, NEW_PASSWORD);

    expect((await describePasswordReset(h, token)).body).toEqual({ state: 'used', email: EMAIL });
  });

  it('мусор, неизвестный токен, удалённый аккаунт — 404 NOT_FOUND', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);

    for (const value of ['garbage', 'A'.repeat(43), encodeURIComponent('a/b')]) {
      const res = await describePasswordReset(h, value);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    expect((await describePasswordReset(h, token)).status).toBe(404);
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(404);
  });
});

describe('POST /v1/auth/password-reset/confirm — смена пароля (AC5)', () => {
  it('пароль заменён, ссылка used, все сессии пользователя отозваны (только его), refresh — 401; лог без ПДн', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await verifiedAccount();
    await verifiedAccount('other@example.com');
    const mine = [await nativeSession(), await nativeSession()];
    const signedOut = await nativeSession();
    await call(h, 'POST', '/v1/auth/session/sign-out', { refreshToken: signedOut });
    const others = await nativeSession('other@example.com');
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    h.clock.advance(MINUTE);

    const res = await confirmPasswordReset(h, token, NEW_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toEqual({ state: 'passwordChanged', email: EMAIL });
    const [link] = await resetRows();
    expect(link?.usedAt).toEqual(h.clock.now());
    for (const refresh of mine) {
      const row = await sessionByRefresh(refresh);
      expect(row).toMatchObject({ revokedAt: h.clock.now(), revokedReason: 'password_reset' });
      expect((await call(h, 'POST', REFRESH, { refreshToken: refresh })).status).toBe(401);
    }
    const out = await sessionByRefresh(signedOut);
    expect(out?.revokedReason).toBe('signed_out');
    expect((await call(h, 'POST', REFRESH, { refreshToken: others })).status).toBe(200);

    expect((await signIn(EMAIL, OLD_PASSWORD)).status).toBe(401);
    expect(SignInResponse.parse((await signIn(EMAIL, NEW_PASSWORD)).body).state).toBe('signedIn');
    expect((await eventTypes()).at(-1)).toBe('identity.password-changed-email-requested');

    expect(log).toHaveBeenCalledWith({
      msg: 'password reset',
      uid: await userIdByEmail(h, EMAIL),
      revoked: 2,
    });
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [EMAIL, token, sha256(token), NEW_PASSWORD, '198.51.100']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('повтор confirm — 410 LINK_EXPIRED с e-mail; argon2 при 404/410 не вызывается', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(200);
    const hash = vi.spyOn(hasher(), 'hash');

    const again = await confirmPasswordReset(h, token, 'another-password');
    const unknown = await confirmPasswordReset(h, 'A'.repeat(43), 'another-password');

    expect(again.status).toBe(410);
    expect(again.body).toMatchObject({ code: 'LINK_EXPIRED', details: { email: EMAIL } });
    expect(unknown.status).toBe(404);
    expect(hash).not.toHaveBeenCalled();
    expect(SignInResponse.parse((await signIn(EMAIL, NEW_PASSWORD)).body).state).toBe('signedIn');
  });

  it('истёкшая ссылка — 410, пароль прежний', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    h.clock.advance(HOUR);

    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(410);
    expect((await signIn(EMAIL, OLD_PASSWORD)).status).toBe(200);
  });

  it('пароль короче 8, длиннее 128, лишний ключ, токен не по формату — 400 до argon2', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const hash = vi.spyOn(hasher(), 'hash');

    for (const body of [
      { token, password: 'x'.repeat(7) },
      { token, password: 'x'.repeat(129) },
      { token, password: NEW_PASSWORD, email: EMAIL },
      { token: 'short', password: NEW_PASSWORD },
    ]) {
      const res = await call(h, 'POST', '/v1/auth/password-reset/confirm', body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(hash).not.toHaveBeenCalled();
    expect((await describePasswordReset(h, token)).body).toMatchObject({ state: 'valid' });
  });
});

describe('неподтверждённый аккаунт (AC6, Q4, R5)', () => {
  it('сброс подтверждает e-mail и гасит токен регистрации: poll прежним — 401, вход новым — signedIn', async () => {
    const { registrationToken } = RegisterResponse.parse((await register(h)).body);
    await requestPasswordReset(h, EMAIL);
    h.clock.advance(MINUTE);

    expect((await confirmPasswordReset(h, await latestResetToken(h), NEW_PASSWORD)).status).toBe(
      200,
    );

    const [user] = await collections(h).users.find().toArray();
    expect(user?.emailVerifiedAt).toEqual(h.clock.now());
    const [regToken] = await collections(h).registrationTokens.find().toArray();
    expect(regToken?.consumedAt).toEqual(h.clock.now());
    expect((await poll(h, registrationToken)).status).toBe(401);
    expect(await collections(h).sessions.countDocuments()).toBe(0);
    expect(SignInResponse.parse((await signIn(EMAIL, NEW_PASSWORD)).body).state).toBe('signedIn');
  });
});

/**
 * Гонки без блокировок строк (R9): «удерживаемая транзакция» — другая транзакция аккаунта открыта и уже записала
 * `users` (`$inc version`), но не закоммичена: проверяемая транзакция получает конфликт записи и повторяется
 * (spy `lockUser*` вызван ≥ 2 раз) до коммита; «ворота» — проверяемая операция приостановлена между проверкой и
 * `lockUser`, другая завершается целиком.
 */
describe('гонки (AC7, R4)', () => {
  const repository = () => h.app.get(IdentityRepository, { strict: false });

  it('вход, проверивший старый пароль, пока сброс «в процессе», — 401 после коммита сброса, без новой сессии', async () => {
    await verifiedAccount();
    const userId = await userIdByEmail(h, EMAIL);
    const newHash = await hasher().hash(NEW_PASSWORD);
    // «сброс» уже сменил хеш под lockUser, но ещё не закоммитил
    const reset = await holdTransaction(h, async (session) => {
      await collections(h).users.updateOne(
        { _id: userId },
        { $inc: { version: 1 }, $set: { passwordHash: newHash } },
        { session },
      );
    });
    const lock = vi.spyOn(repository(), 'lockUserCredentials');
    // вход читает прежний (закоммиченный) хеш, проверяет старый пароль и повторяет транзакцию на конфликте записи
    const signing = signIn(EMAIL, OLD_PASSWORD);
    await untilBlocked(signing, retried(lock));
    await reset.commit();

    const res = await signing;
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });

  it('poll подтверждённого аккаунта, начатый до сброса и продолженный после него, — 401 без новой сессии (R5)', async () => {
    const { registrationToken } = RegisterResponse.parse((await register(h)).body);
    await confirm(h, await activeLinkToken(h)); // подтверждён, токен регистрации ещё не обменян
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);

    // poll запомнил своё «сейчас» и прочитал токен, но до блокировки аккаунта приостановлен
    const target = repository();
    const lockUser = target.lockUser.bind(target);
    const paused = gate();
    vi.spyOn(target, 'lockUser').mockImplementationOnce(async (session, userId) => {
      await paused.wait();
      return lockUser(session, userId);
    });
    const polling = poll(h, registrationToken);
    await paused.reached;

    // сброс с более поздним временем завершается первым
    h.clock.advance(MINUTE);
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(200);
    paused.open();

    const res = await polling;
    expect(res.status).toBe(401);
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });

  it('confirm, ждавший другую транзакцию аккаунта, пока ссылка истекла, — 410; пароль и сессии не изменены', async () => {
    await verifiedAccount();
    const refresh = await nativeSession();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const userId = await userIdByEmail(h, EMAIL);
    h.clock.advance(HOUR - MINUTE); // ссылка ещё жива минуту
    // другая транзакция аккаунта держит документ users
    const holder = await holdTransaction(h, async (session) => {
      await collections(h).users.updateOne({ _id: userId }, { $inc: { version: 1 } }, { session });
    });
    const lock = vi.spyOn(repository(), 'lockUser');
    const confirming = confirmPasswordReset(h, token, NEW_PASSWORD);
    await untilBlocked(confirming, retried(lock));
    h.clock.advance(MINUTE); // пока confirm повторяется, срок ссылки прошёл
    await holder.commit();

    const res = await confirming;
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: 'LINK_EXPIRED', details: { email: EMAIL } });
    const [link] = await resetRows();
    expect(link?.usedAt).toBeNull();
    const [row] = await collections(h).sessions.find().toArray();
    expect(row?.revokedAt).toBeNull();
    expect((await signIn(EMAIL, OLD_PASSWORD)).status).toBe(200);
    expect((await call(h, 'POST', REFRESH, { refreshToken: refresh })).status).toBe(200);
  });

  it('два confirm одной ссылкой параллельно — один 200, один 410', async () => {
    await verifiedAccount();
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);

    const results = await Promise.all([
      confirmPasswordReset(h, token, NEW_PASSWORD),
      confirmPasswordReset(h, token, 'another-password'),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 410]);
    expect(
      (await eventTypes()).filter((type) => type === 'identity.password-changed-email-requested'),
    ).toHaveLength(1);
  });
});
