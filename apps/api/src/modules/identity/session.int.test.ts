import {
  CookieSession,
  RateLimitedDetails,
  RegisterResponse,
  RegistrationPollResponse,
  Session,
  SESSION_COOKIE,
} from '@pokatim/contracts';
import { jwtVerify } from 'jose';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, MINUTE, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  type CallResult,
  collections,
  confirm,
  poll,
  register,
} from '../../../test/identity';
import { IDENTITY_POLICY } from './identity.policy';
import { randomToken, sha256 } from './tokens';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const REFRESH = '/v1/auth/session/refresh';
const SIGN_OUT = '/v1/auth/session/sign-out';
const cookieHeader = (token: string) => ({ cookie: `${SESSION_COOKIE.name}=${token}` });

/** Значение cookie сессии из Set-Cookie ответа (`undefined` — не ставилась). */
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
const isCleared = (res: CallResult) =>
  cookieValue(res) === '' && /Max-Age=0/.test(setCookie(res) ?? '');

/** Регистрация → подтверждение → poll с транспортом: ответ poll. */
async function signUp(transport?: 'body' | 'cookie'): Promise<CallResult> {
  const registered = RegisterResponse.parse((await register(h)).body);
  await confirm(h, await activeLinkToken(h));
  return poll(h, registered.registrationToken, transport);
}

/** Web-вход: refresh из cookie ответа poll. */
async function webSignIn(): Promise<string> {
  const token = cookieValue(await signUp('cookie'));
  if (!token) throw new Error('cookie не выставлена');
  return token;
}

/** Native-вход: refresh из тела ответа poll. */
async function nativeSignIn(): Promise<string> {
  const body = RegistrationPollResponse.parse((await signUp()).body);
  if (body.state !== 'verified') throw new Error('expected verified');
  return Session.parse(body.session).refreshToken;
}

const refreshByCookie = (token: string) => call(h, 'POST', REFRESH, {}, cookieHeader(token));
const refreshByBody = (token: string) => call(h, 'POST', REFRESH, { refreshToken: token });

describe('POST /v1/auth/registration/poll — транспорт сессии', () => {
  it('cookie: Set-Cookie HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/session, в теле refresh нет', async () => {
    const res = await signUp('cookie');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const header = setCookie(res) ?? '';
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; Secure/);
    expect(header).toMatch(/; SameSite=Strict/);
    expect(header).toMatch(/; Path=\/v1\/auth\/session(;|$)/);
    expect(header).toMatch(
      new RegExp(`; Max-Age=${IDENTITY_POLICY.refreshTokenTtlMs / 1000}(;|$)`),
    );
    expect(header).not.toMatch(/domain=/i);
    const body = RegistrationPollResponse.parse(res.body);
    if (body.state !== 'verified') throw new Error('expected verified');
    expect(body.session).not.toHaveProperty('refreshToken');
    expect(Object.keys(body.session).sort()).toEqual(
      ['accessToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'].sort(),
    );
    const [session] = await collections(h).sessions.find().toArray();
    expect(session?.refreshTokenHash).toBe(sha256(cookieValue(res) ?? ''));
  });

  it('без транспорта (старая сборка native) и body — прежний Session, без Set-Cookie', async () => {
    const legacy = await signUp();
    expect(setCookie(legacy)).toBeUndefined();
    const body = RegistrationPollResponse.parse(legacy.body);
    if (body.state !== 'verified') throw new Error('expected verified');
    expect(Session.safeParse(body.session).success).toBe(true);

    await h.reset();
    const explicit = await signUp('body');
    expect(setCookie(explicit)).toBeUndefined();
    const explicitBody = RegistrationPollResponse.parse(explicit.body);
    if (explicitBody.state !== 'verified') throw new Error('expected verified');
    expect(Session.safeParse(explicitBody.session).success).toBe(true);
  });

  it('sessionTransport вне enum → 400', async () => {
    const registered = RegisterResponse.parse((await register(h)).body);
    const res = await call(h, 'POST', '/v1/auth/registration/poll', {
      registrationToken: registered.registrationToken,
      sessionTransport: 'header',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/auth/session/refresh', () => {
  it('по cookie: новая cookie, тело — CookieSession, предыдущий хеш и rotated_at; срок скользящий (Q5)', async () => {
    const first = await webSignIn();
    const [before] = await collections(h).sessions.find().toArray();
    h.clock.advance(DAY);

    const res = await refreshByCookie(first);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toHaveProperty('refreshToken');
    const body = CookieSession.parse(res.body);
    const next = cookieValue(res);
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe(first);
    // скользящий срок: 30 дней от ротации, Max-Age — весь этот срок
    const slid = new Date(h.clock.now().getTime() + IDENTITY_POLICY.refreshTokenTtlMs);
    expect(setCookie(res)).toMatch(
      new RegExp(`Max-Age=${IDENTITY_POLICY.refreshTokenTtlMs / 1000}(;|$)`),
    );
    expect(body.refreshTokenExpiresAt).toBe(slid.toISOString());
    const [after] = await collections(h).sessions.find().toArray();
    // та же сессия (sid в access), новый хеш, прежний — в previous; сырого токена в БД нет
    expect(after?._id).toBe(before?._id);
    expect(after?.refreshTokenHash).toBe(sha256(next ?? ''));
    expect(after?.previousRefreshTokenHash).toBe(sha256(first));
    expect(after?.rotatedAt).toEqual(h.clock.now());
    expect(after?.expiresAt).toEqual(slid);
    const { payload } = await jwtVerify(
      body.accessToken,
      new TextEncoder().encode(h.env.JWT_SECRET),
      {
        issuer: 'pokatim',
        audience: 'pokatim-app',
        currentDate: h.clock.now(),
      },
    );
    expect(payload).toMatchObject({ sub: before?.userId, sid: before?._id });

    // предыдущий вне окна повтора — reuse: 401, сессия отозвана, её текущий токен тоже мёртв
    h.clock.advance(IDENTITY_POLICY.refreshReuseGraceMs + 1000);
    const replay = await refreshByCookie(first);
    expect(replay.status).toBe(401);
    expect(isCleared(replay)).toBe(true);
    expect((await refreshByCookie(next ?? '')).status).toBe(401);
  });

  it('по телу (native): новый refreshToken в теле, без Set-Cookie; новый работает', async () => {
    const first = await nativeSignIn();

    const res = await refreshByBody(first);

    expect(res.status).toBe(200);
    expect(setCookie(res)).toBeUndefined();
    const body = Session.parse(res.body);
    expect(body.refreshToken).not.toBe(first);
    const [row] = await collections(h).sessions.find().toArray();
    expect(row?.refreshTokenHash).toBe(sha256(body.refreshToken));
    expect((await refreshByBody(body.refreshToken)).status).toBe(200);
  });

  it('access не живёт дольше сессии (у абсолютного предела)', async () => {
    const token = await webSignIn();
    // до абсолютного предела сессии — 5 минут, меньше срока access
    await collections(h).sessions.updateMany(
      {},
      {
        $set: {
          createdAt: new Date(
            h.clock.now().getTime() - IDENTITY_POLICY.sessionAbsoluteTtlMs + 5 * MINUTE,
          ),
        },
      },
    );

    const body = CookieSession.parse((await refreshByCookie(token)).body);

    const [row] = await collections(h).sessions.find().toArray();
    expect(row?.expiresAt).toEqual(new Date(h.clock.now().getTime() + 5 * MINUTE));
    expect(body.accessTokenExpiresAt).toBe(row?.expiresAt.toISOString());
  });

  it('истёкшая, отозванная, удалённый пользователь, нет cookie, мусор, неизвестный → одинаковый 401; сброс — только предъявленной cookie', async () => {
    const results: CallResult[] = [];

    const expired = await webSignIn();
    h.clock.advance(IDENTITY_POLICY.refreshTokenTtlMs);
    results.push(await refreshByCookie(expired));

    await h.reset();
    const revoked = await webSignIn();
    await collections(h).sessions.updateMany({}, { $set: { revokedAt: h.clock.now() } });
    results.push(await refreshByCookie(revoked));

    await h.reset();
    const orphan = await webSignIn();
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    results.push(await refreshByCookie(orphan));

    results.push(await refreshByCookie('not-a-token'));
    results.push(await refreshByCookie(randomToken()));
    // без cookie сбрасывать нечего: Set-Cookie сброса стёр бы cookie, выданную тем временем poll другой вкладки
    const anonymous = await call(h, 'POST', REFRESH, {});

    for (const res of [...results, anonymous]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    for (const res of results) expect(isCleared(res)).toBe(true);
    expect(setCookie(anonymous)).toBeUndefined();
    expect(new Set([...results, anonymous].map((res) => JSON.stringify(res.body))).size).toBe(1);
  });

  it('refreshToken в теле не по схеме → 400 (валидация контракта)', async () => {
    expect((await refreshByBody('short')).status).toBe(400);
  });

  // F5b: [200, 401×4]; с окном повтора (R3 слайса 2) второй — повтор предыдущим токеном в окне
  it('гонка 5 refresh одним токеном — ровно два 200 (текущим и повтором в окне), сессия жива', async () => {
    const token = await webSignIn();

    const results = await Promise.all(Array.from({ length: 5 }, () => refreshByCookie(token)));

    expect(results.map((res) => res.status).sort()).toEqual([200, 200, 401, 401, 401]);
    const [row] = await collections(h).sessions.find().toArray();
    expect(row?.revokedAt).toBeNull();
    const issued = results.filter((res) => res.status === 200).map((res) => cookieValue(res));
    expect(issued.map((value) => sha256(value ?? ''))).toContain(row?.refreshTokenHash);
    // проигравшие 401 — без отзыва и без reuse: токен в окне
    expect(row?.revokedReason).toBeNull();
  });

  it(`лимит по IP: ${IDENTITY_POLICY.refreshPerIpLimit.limit} в окно, дальше 429 с retryAfterSec`, async () => {
    const { limit } = IDENTITY_POLICY.refreshPerIpLimit;
    for (let i = 0; i < limit; i += 1) {
      expect((await refreshByCookie(randomToken())).status).toBe(401);
    }

    const res = await refreshByCookie(randomToken());

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    const details = RateLimitedDetails.parse((res.body as { details: unknown }).details);
    expect(details.retryAfterSec).toBeGreaterThan(0);
    // 429 не сбрасывает cookie: токен мог быть живым
    expect(setCookie(res)).toBeUndefined();
  });
});

describe('окно повтора и reuse detection (R3, AC5)', () => {
  const GRACE = IDENTITY_POLICY.refreshReuseGraceMs;

  it('предыдущий токен в окне (+59 с) — 200, та же сессия; брошенный текущий становится предыдущим', async () => {
    const first = await nativeSignIn();
    const second = Session.parse((await refreshByBody(first)).body).refreshToken;
    const [before] = await collections(h).sessions.find().toArray();
    h.clock.advance(GRACE - 1000);

    // ответ с `second` потерялся — клиент повторяет `first`
    const retry = await refreshByBody(first);

    expect(retry.status).toBe(200);
    const third = Session.parse(retry.body).refreshToken;
    const [after] = await collections(h).sessions.find().toArray();
    expect(after?._id).toBe(before?._id);
    expect(after?.refreshTokenHash).toBe(sha256(third));
    expect(after?.previousRefreshTokenHash).toBe(sha256(second));
    // брошенный `second` позже окна — reuse
    h.clock.advance(GRACE + 1000);
    expect((await refreshByBody(second)).status).toBe(401);
    const [revoked] = await collections(h).sessions.find().toArray();
    expect(revoked?.revokedReason).toBe('reuse_detected');
  });

  it('предыдущий вне окна (+61 с) — 401, сессия отозвана (reuse_detected), текущий после — 401; лог без токена', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const first = await nativeSignIn();
    const second = Session.parse((await refreshByBody(first)).body).refreshToken;
    h.clock.advance(GRACE + 1000);

    const reuse = await refreshByBody(first);

    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
    const [row] = await collections(h).sessions.find().toArray();
    expect(row).toMatchObject({ revokedAt: h.clock.now(), revokedReason: 'reuse_detected' });
    expect((await refreshByBody(second)).status).toBe(401);

    expect(warn).toHaveBeenCalledWith({
      msg: 'session revoked',
      sid: row?._id,
      reason: 'reuse_detected',
    });
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of [first, second, sha256(first), 'rider@example.com']) {
      expect(logged).not.toContain(secret);
    }
    warn.mockRestore();
  });

  it('неизвестный токен — 401 без отзыва чужих сессий', async () => {
    await nativeSignIn();

    expect((await refreshByBody(randomToken())).status).toBe(401);

    const [row] = await collections(h).sessions.find().toArray();
    expect(row?.revokedAt).toBeNull();
  });

  it('скользящий срок упирается в абсолютный предел от входа (Q5)', async () => {
    const token = await nativeSignIn();
    const [row] = await collections(h).sessions.find().toArray();
    const createdAt = row?.createdAt ?? new Date(0);
    // вход был давно: до предела остаётся 10 дней — меньше обычных 30
    await collections(h).sessions.updateMany(
      {},
      {
        $set: {
          createdAt: new Date(
            h.clock.now().getTime() - IDENTITY_POLICY.sessionAbsoluteTtlMs + 10 * DAY,
          ),
        },
      },
    );

    const body = Session.parse((await refreshByBody(token)).body);

    const limit = new Date(h.clock.now().getTime() + 10 * DAY);
    expect(body.refreshTokenExpiresAt).toBe(limit.toISOString());
    const [after] = await collections(h).sessions.find().toArray();
    expect(after?.expiresAt).toEqual(limit);
    expect(createdAt).toEqual(h.clock.now());
  });
});

describe('POST /v1/auth/session/sign-out', () => {
  it('предыдущим токеном (гонка выхода с ротацией) — сессия отозвана, текущий после — 401', async () => {
    const first = await nativeSignIn();
    const second = Session.parse((await refreshByBody(first)).body).refreshToken;

    const res = await call(h, 'POST', SIGN_OUT, { refreshToken: first });

    expect(res.status).toBe(204);
    const [row] = await collections(h).sessions.find().toArray();
    expect(row).toMatchObject({ revokedAt: h.clock.now(), revokedReason: 'signed_out' });
    expect((await refreshByBody(second)).status).toBe(401);
  });

  it('по cookie: 204 без тела, cookie сброшена, revoked_at; повтор — 204; refresh после — 401', async () => {
    const token = await webSignIn();

    const res = await call(h, 'POST', SIGN_OUT, {}, cookieHeader(token));

    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(isCleared(res)).toBe(true);
    const [row] = await collections(h).sessions.find().toArray();
    expect(row).toMatchObject({ revokedAt: h.clock.now(), revokedReason: 'signed_out' });

    const again = await call(h, 'POST', SIGN_OUT, {}, cookieHeader(token));
    expect(again.status).toBe(204);
    expect(again.body).toBeUndefined();
    expect((await refreshByCookie(token)).status).toBe(401);
  });

  it('по телу (native): 204, сессия отозвана, cookie не трогаем', async () => {
    const token = await nativeSignIn();

    const res = await call(h, 'POST', SIGN_OUT, { refreshToken: token });

    expect(res.status).toBe(204);
    expect(setCookie(res)).toBeUndefined();
    const row = await collections(h).sessions.findOne({ refreshTokenHash: sha256(token) });
    expect(row?.revokedAt).toEqual(h.clock.now());
    expect((await refreshByBody(token)).status).toBe(401);
  });

  it('без cookie, с мусором или неизвестным токеном — 204 (идемпотентно, без оракула)', async () => {
    for (const headers of [{}, cookieHeader('garbage'), cookieHeader(randomToken())]) {
      const res = await call(h, 'POST', SIGN_OUT, {}, headers);
      expect(res.status).toBe(204);
      expect(res.body).toBeUndefined();
      expect(isCleared(res)).toBe(true);
    }
  });
});
