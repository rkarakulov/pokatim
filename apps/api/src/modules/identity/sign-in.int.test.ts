import {
  CookieSession,
  RateLimitedDetails,
  RegisterResponse,
  Session,
  SESSION_COOKIE,
  SignInResponse,
} from '@pokatim/contracts';
import { jwtVerify } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  type CallResult,
  collections,
  confirm,
  poll,
  register,
  resend,
  validRegistration,
} from '../../../test/identity';
import { IDENTITY_POLICY } from './identity.policy';
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

const SIGN_IN = '/v1/auth/session/sign-in';
const REFRESH = '/v1/auth/session/refresh';
const { email: EMAIL, password: PASSWORD } = validRegistration();

/** Вход «с IP клиента» за прокси. */
const signIn = (body: Record<string, unknown>, ip = '198.51.100.1', cookie?: string) =>
  call(h, 'POST', SIGN_IN, body, {
    'x-forwarded-for': ip,
    ...(cookie ? { cookie: `${SESSION_COOKIE.name}=${cookie}` } : {}),
  });

/** Подтверждённый аккаунт `rider@example.com` (пароль из validRegistration). */
async function verifiedAccount(): Promise<void> {
  await register(h);
  await confirm(h, await activeLinkToken(h));
}

function setCookie(res: CallResult): string | undefined {
  const header = res.headers['set-cookie'];
  const all = Array.isArray(header) ? header : header === undefined ? [] : [String(header)];
  return all.find((value: unknown) => String(value).startsWith(`${SESSION_COOKIE.name}=`)) as
    string | undefined;
}
const cookieValue = (res: CallResult) =>
  setCookie(res)
    ?.split(';')[0]
    ?.slice(SESSION_COOKIE.name.length + 1);

const hasher = () => h.app.get(PasswordHasher, { strict: false });

describe('POST /v1/auth/session/sign-in — успех (AC1)', () => {
  it('native (body): Session с refresh, сессия в БД — только хешем; e-mail в любом регистре и с пробелами', async () => {
    await verifiedAccount();

    const res = await signIn({ email: '  Rider@Example.COM ', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookie(res)).toBeUndefined();
    const body = SignInResponse.parse(res.body);
    if (body.state !== 'signedIn') throw new Error('expected signedIn');
    const session = Session.parse(body.session);
    const [row] = await collections(h).sessions.find().toArray();
    const [user] = await collections(h).users.find().toArray();
    expect(row?.refreshTokenHash).toBe(sha256(session.refreshToken));
    expect(row?.userId).toBe(user?._id);
    expect(session.refreshTokenExpiresAt).toBe(
      new Date(h.clock.now().getTime() + IDENTITY_POLICY.refreshTokenTtlMs).toISOString(),
    );
    const { payload } = await jwtVerify(
      session.accessToken,
      new TextEncoder().encode(h.env.JWT_SECRET),
      { issuer: 'pokatim', audience: 'pokatim-app', currentDate: h.clock.now() },
    );
    expect(payload).toMatchObject({ sub: user?._id, sid: row?._id });
  });

  it('web (cookie): CookieSession без refresh, cookie с атрибутами F5b; refresh по ней работает', async () => {
    await verifiedAccount();

    const res = await signIn({ email: EMAIL, password: PASSWORD, sessionTransport: 'cookie' });

    expect(res.status).toBe(200);
    const body = SignInResponse.parse(res.body);
    if (body.state !== 'signedIn') throw new Error('expected signedIn');
    expect(body.session).not.toHaveProperty('refreshToken');
    expect(CookieSession.safeParse(body.session).success).toBe(true);
    const header = setCookie(res) ?? '';
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; Secure/);
    expect(header).toMatch(/; SameSite=Strict/);
    expect(header).toMatch(/; Path=\/v1\/auth\/session(;|$)/);
    expect(header).toMatch(
      new RegExp(`; Max-Age=${IDENTITY_POLICY.refreshTokenTtlMs / 1000}(;|$)`),
    );
    expect(header).not.toMatch(/domain=/i);

    const refreshed = await call(
      h,
      'POST',
      REFRESH,
      {},
      { cookie: `${SESSION_COOKIE.name}=${cookieValue(res)}` },
    );
    expect(refreshed.status).toBe(200);
  });

  it('web-вход при живой cookie прежней сессии этого браузера — прежняя сессия отозвана (superseded) (AC6)', async () => {
    await verifiedAccount();
    const first = cookieValue(
      await signIn({ email: EMAIL, password: PASSWORD, sessionTransport: 'cookie' }),
    );

    const res = await signIn(
      { email: EMAIL, password: PASSWORD, sessionTransport: 'cookie' },
      '198.51.100.1',
      first,
    );

    expect(res.status).toBe(200);
    const next = cookieValue(res);
    expect(next).not.toBe(first);
    const old = await collections(h).sessions.findOne({ refreshTokenHash: sha256(first ?? '') });
    expect(old).toMatchObject({ revokedAt: h.clock.now(), revokedReason: 'superseded' });
    const fresh = await collections(h).sessions.findOne({ refreshTokenHash: sha256(next ?? '') });
    expect(fresh?.revokedAt).toBeNull();
  });

  it('мусор в cookie при входе — вход проходит, ничего не отзывается', async () => {
    await verifiedAccount();

    const res = await signIn(
      { email: EMAIL, password: PASSWORD, sessionTransport: 'cookie' },
      '198.51.100.1',
      'garbage',
    );

    expect(res.status).toBe(200);
    expect(cookieValue(res)).toMatch(/^[\w-]{43}$/);
  });
});

describe('нейтральный отказ (AC2)', () => {
  it('неверный пароль, неизвестный и удалённый e-mail — 401 INVALID_CREDENTIALS, тела побайтно одинаковы', async () => {
    await verifiedAccount();
    const wrong = await signIn({ email: EMAIL, password: 'wrong-password' });
    const unknown = await signIn({ email: 'nobody@example.com', password: PASSWORD });
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    const deleted = await signIn({ email: EMAIL, password: PASSWORD });

    for (const res of [wrong, unknown, deleted]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'INVALID_CREDENTIALS', message: expect.any(String) });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(setCookie(res)).toBeUndefined();
    }
    expect(new Set([wrong, unknown, deleted].map((res) => JSON.stringify(res.body))).size).toBe(1);
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });

  it('для неизвестного адреса argon2 verify вызывается (по пустышке) — время ответа не выдаёт аккаунт', async () => {
    const verify = vi.spyOn(hasher(), 'verify');

    const res = await signIn({ email: 'nobody@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(await hasher().dummyHash(), PASSWORD);
  });

  it('тело не по контракту (пустой пароль, лишний ключ, транспорт вне enum) → 400 до проверки пароля', async () => {
    const verify = vi.spyOn(hasher(), 'verify');
    for (const body of [
      { email: EMAIL, password: '' },
      { email: EMAIL, password: PASSWORD, remember: true },
      { email: EMAIL, password: PASSWORD, sessionTransport: 'header' },
      { email: EMAIL, password: 'x'.repeat(129) },
    ]) {
      const res = await signIn(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('лимиты попыток (AC3, Q1/Q2)', () => {
  const { emailIp, email, ip } = IDENTITY_POLICY.signInLimits;

  it(`e-mail+IP: ${emailIp.limit} попыток за окно, дальше 429 + retryAfterSec и с верным паролем, без проверки пароля; после окна — вход`, async () => {
    await verifiedAccount();
    for (let i = 0; i < emailIp.limit; i += 1) {
      expect((await signIn({ email: EMAIL, password: 'wrong-password' })).status).toBe(401);
    }
    const verify = vi.spyOn(hasher(), 'verify');

    const blocked = await signIn({ email: EMAIL, password: PASSWORD });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    const details = RateLimitedDetails.parse((blocked.body as { details: unknown }).details);
    expect(details.retryAfterSec).toBe(emailIp.windowSec);
    expect(verify).not.toHaveBeenCalled();
    // с другого IP владелец входит: чужие ошибки с одного адреса аккаунт не блокируют (R1б)
    expect((await signIn({ email: EMAIL, password: PASSWORD }, '198.51.100.2')).status).toBe(200);

    h.clock.advance(emailIp.windowSec * 1000);
    expect((await signIn({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('несуществующий адрес — тот же 429 с тем же retryAfterSec (без оракула)', async () => {
    await verifiedAccount();
    const exhaust = async (address: string) => {
      for (let i = 0; i < emailIp.limit; i += 1) await signIn({ email: address, password: 'x' });
      return signIn({ email: address, password: 'x' });
    };

    const existing = await exhaust(EMAIL);
    const missing = await exhaust('nobody@example.com');

    expect(existing.status).toBe(429);
    expect(missing.status).toBe(429);
    expect(missing.body).toEqual(existing.body);
  });

  it(`e-mail со всех IP: ${email.limit} за окно, дальше 429 с нового IP`, async () => {
    for (let i = 0; i < email.limit; i += 1) {
      expect((await signIn({ email: EMAIL, password: 'x' }, `203.0.113.${i}`)).status).toBe(401);
    }
    expect((await signIn({ email: EMAIL, password: 'x' }, '203.0.113.200')).status).toBe(429);
  });

  it('попытки сверх лимита e-mail+IP с одного адреса не списываются с e-mail: владелец входит с другого IP (R1б)', async () => {
    await verifiedAccount();
    for (let i = 0; i < email.limit; i += 1) {
      await signIn({ email: EMAIL, password: 'wrong-password' }, '198.51.100.66');
    }

    expect((await signIn({ email: EMAIL, password: PASSWORD }, '198.51.100.2')).status).toBe(200);
  });

  it('отказ по IP — тело и retryAfterSec отказавшего правила; e-mail-счётчики не списываются', async () => {
    for (let i = 0; i < ip.limit; i += 1) {
      await signIn({ email: `rider${i}@example.com`, password: 'x' });
    }
    h.clock.advance(MINUTE);

    const blocked = await signIn({ email: EMAIL, password: 'x' });

    expect(blocked.status).toBe(429);
    const details = RateLimitedDetails.parse((blocked.body as { details: unknown }).details);
    expect(details.retryAfterSec).toBe(ip.windowSec - 60);
    expect(await h.redis.keys('rl:signin-email*')).toHaveLength(2 * ip.limit);
  });

  it('IPv6: адреса одной /64 — один счётчик IP (смена суффикса лимит не обходит)', async () => {
    for (let i = 0; i < ip.limit; i += 1) {
      await signIn({ email: `rider${i}@example.com`, password: 'x' }, `2001:db8:1:2::${i + 1}`);
    }
    expect((await signIn({ email: EMAIL, password: 'x' }, '2001:db8:1:2:ffff::9')).status).toBe(
      429,
    );
    expect((await signIn({ email: EMAIL, password: 'x' }, '2001:db8:1:3::1')).status).toBe(401);
  });

  it(`IP: ${ip.limit} попыток по разным адресам за окно, дальше 429`, async () => {
    for (let i = 0; i < ip.limit; i += 1) {
      expect((await signIn({ email: `rider${i}@example.com`, password: 'x' })).status).toBe(401);
    }
    expect((await signIn({ email: 'other@example.com', password: 'x' })).status).toBe(429);
  });

  it('в Redis — только HMAC-ключи: ни e-mail, ни IP', async () => {
    await signIn({ email: EMAIL, password: 'x' }, '198.51.100.77');

    const keys = await h.redis.keys('rl:signin-*');
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).not.toContain('rider');
      expect(key).not.toContain('198.51.100');
    }
  });
});

describe('неподтверждённый аккаунт (AC4, Q4)', () => {
  it('верный пароль — verificationRequired с новым токеном регистрации: он работает в poll и resend, прежний — 401', async () => {
    const registered = RegisterResponse.parse((await register(h)).body);
    h.clock.advance(2 * MINUTE);

    const res = await signIn({ email: EMAIL, password: PASSWORD, sessionTransport: 'cookie' });

    expect(res.status).toBe(200);
    expect(setCookie(res)).toBeUndefined();
    const body = SignInResponse.parse(res.body);
    if (body.state !== 'verificationRequired') throw new Error('expected verificationRequired');
    expect(body.email).toBe(EMAIL);
    expect(body.registrationToken).not.toBe(registered.registrationToken);
    expect(await collections(h).sessions.countDocuments()).toBe(0);
    const [row] = await collections(h).registrationTokens.find().toArray();
    expect(row?.tokenHash).toBe(sha256(body.registrationToken));
    expect(row?.expiresAt).toEqual(
      new Date(h.clock.now().getTime() + IDENTITY_POLICY.verificationLinkTtlMs),
    );

    expect((await poll(h, registered.registrationToken)).status).toBe(401);
    expect((await poll(h, body.registrationToken)).body).toEqual({ state: 'pending' });
    expect((await resend(h, { registrationToken: body.registrationToken })).body).toMatchObject({
      resendAvailableInSec: expect.any(Number),
    });

    // подтверждение — и новый токен меняется на сессию
    await confirm(h, await activeLinkToken(h));
    const verified = await poll(h, body.registrationToken);
    expect(verified.body).toMatchObject({ state: 'verified' });
  });

  it('токен регистрации уже истёк — вход выдаёт новый живой', async () => {
    await register(h);
    h.clock.advance(IDENTITY_POLICY.verificationLinkTtlMs + MINUTE);

    const body = SignInResponse.parse((await signIn({ email: EMAIL, password: PASSWORD })).body);

    if (body.state !== 'verificationRequired') throw new Error('expected verificationRequired');
    expect((await poll(h, body.registrationToken)).body).toEqual({ state: 'pending' });
  });

  it('неверный пароль у неподтверждённого — тот же 401, токен регистрации не меняется', async () => {
    const registered = RegisterResponse.parse((await register(h)).body);

    const res = await signIn({ email: EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect((await poll(h, registered.registrationToken)).body).toEqual({ state: 'pending' });
  });
});
