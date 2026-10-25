import { Session } from '@pokatim/contracts';
import { SignJWT, UnsecuredJWT, decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import {
  bearer,
  call,
  type CallResult,
  collections,
  confirmPasswordReset,
  latestResetToken,
  requestPasswordReset,
  signUpSession,
} from '../../../test/identity';
import { IDENTITY_POLICY } from './identity.policy';

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

// первый эндпоинт под AuthGuard (модуль profile) — через него проверяется гард целиком
const ONBOARDING = '/v1/profile/onboarding';
const status = (headers: Record<string, string> = {}) =>
  call(h, 'GET', ONBOARDING, undefined, headers);

/** Эталон отказа: тело 401 одинаково для любой причины (без оракула). */
let reference: CallResult;
beforeEach(async () => {
  reference = await status();
});
function expectUnauthorized(res: CallResult) {
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
  expect(JSON.stringify(res.body)).toBe(JSON.stringify(reference.body));
}

/** Access с настоящим ключом стенда и подменёнными claims. */
function forge(
  claims: { sub: string; sid: string },
  overrides: { iss?: string; aud?: string; secret?: string } = {},
) {
  const now = h.clock.now();
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(overrides.iss ?? 'pokatim')
    .setAudience(overrides.aud ?? 'pokatim-app')
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(new Date(now.getTime() + 15 * MINUTE))
    .sign(new TextEncoder().encode(overrides.secret ?? h.env.JWT_SECRET));
}

const claimsOf = (session: Session) => {
  const payload = decodeJwt(session.accessToken);
  return { sub: String(payload.sub), sid: String(payload.sid) };
};

describe('AuthGuard (AC2): живой access → 200', () => {
  it('access из poll — 200', async () => {
    const session = await signUpSession(h);
    const res = await status(bearer(session.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ surveyCompleted: false, devicesStepCompleted: false });
  });

  it('access после ротации refresh — 200 (sid тот же)', async () => {
    const session = await signUpSession(h);
    const rotated = await call(h, 'POST', '/v1/auth/session/refresh', {
      refreshToken: session.refreshToken,
    });
    expect((await status(bearer(Session.parse(rotated.body).accessToken))).status).toBe(200);
  });
});

describe('AuthGuard (AC2): любой отказ — один и тот же 401', () => {
  it('без заголовка, Basic, мусор, не JWT', async () => {
    expectUnauthorized(reference);
    expectUnauthorized(await status({ authorization: 'Basic dXNlcjpwYXNz' }));
    expectUnauthorized(await status({ authorization: 'Bearer garbage' }));
    expectUnauthorized(await status({ authorization: 'Bearer a.b.c' }));
    expectUnauthorized(await status({ authorization: `Bearer ${'a'.repeat(3000)}.b.c` }));
  });

  it('alg: none, чужой ключ, чужие iss/aud', async () => {
    const claims = claimsOf(await signUpSession(h));
    const unsecured = new UnsecuredJWT({ sid: claims.sid })
      .setIssuer('pokatim')
      .setAudience('pokatim-app')
      .setSubject(claims.sub)
      .setIssuedAt(h.clock.now())
      .setExpirationTime(new Date(h.clock.now().getTime() + MINUTE))
      .encode();
    expectUnauthorized(await status({ authorization: `Bearer ${unsecured}` }));
    expectUnauthorized(
      await status(bearer(await forge(claims, { secret: 'other-jwt-secret-other-jwt-secret-00' }))),
    );
    expectUnauthorized(await status(bearer(await forge(claims, { iss: 'other' }))));
    expectUnauthorized(await status(bearer(await forge(claims, { aud: 'other' }))));
    // контроль: та же подделка с настоящими параметрами проходит — отказы выше не случайны
    expect((await status(bearer(await forge(claims)))).status).toBe(200);
  });

  it('истёкший access (CLOCK + 15 мин)', async () => {
    const session = await signUpSession(h);
    h.clock.advance(IDENTITY_POLICY.accessTokenTtlMs);
    expectUnauthorized(await status(bearer(session.accessToken)));
  });

  it('sid сессии, отозванной выходом', async () => {
    const session = await signUpSession(h);
    await call(h, 'POST', '/v1/auth/session/sign-out', { refreshToken: session.refreshToken });
    expectUnauthorized(await status(bearer(session.accessToken)));
  });

  it('sid сессии, отозванной сбросом пароля', async () => {
    const session = await signUpSession(h);
    await requestPasswordReset(h, 'rider@example.com');
    const reset = await confirmPasswordReset(h, await latestResetToken(h), 'new-long-password');
    expect(reset.status).toBe(200);
    expectUnauthorized(await status(bearer(session.accessToken)));
  });

  it('sid сессии, отозванной reuse detection', async () => {
    const session = await signUpSession(h);
    const refresh = (token: string) =>
      call(h, 'POST', '/v1/auth/session/refresh', { refreshToken: token });
    const rotated = Session.parse((await refresh(session.refreshToken)).body);
    h.clock.advance(IDENTITY_POLICY.refreshReuseGraceMs + 1_000);
    expect((await refresh(session.refreshToken)).status).toBe(401);
    expectUnauthorized(await status(bearer(rotated.accessToken)));
  });

  it('истёкшая сессия (access ещё в сроке)', async () => {
    const session = await signUpSession(h);
    await collections(h).sessions.updateMany({}, { $set: { expiresAt: h.clock.now() } });
    expectUnauthorized(await status(bearer(session.accessToken)));
  });

  it('sid другого пользователя (подпись верная)', async () => {
    const mine = claimsOf(await signUpSession(h, 'rider@example.com'));
    const other = claimsOf(await signUpSession(h, 'other@example.com'));
    expectUnauthorized(await status(bearer(await forge({ sub: mine.sub, sid: other.sid }))));
  });

  it('удалённый пользователь', async () => {
    const session = await signUpSession(h);
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    expectUnauthorized(await status(bearer(session.accessToken)));
  });
});
