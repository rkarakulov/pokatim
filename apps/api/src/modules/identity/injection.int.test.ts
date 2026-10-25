import { RegisterResponse } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  collections,
  confirm,
  poll,
  register,
  requestPasswordReset,
} from '../../../test/identity';

/**
 * Операторная инъекция MongoDB (§8.3 п. 2): объекты запроса вместо строк отсекает контракт (zod) — 400 до БД;
 * в фильтры попадают только примитивы.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const snapshot = async () => {
  const db = collections(h);
  return {
    users: await db.users.find().toArray(),
    sessions: await db.sessions.find().toArray(),
    links: await db.emailVerificationTokens.find().toArray(),
    resets: await db.passwordResetTokens.find().toArray(),
    registrations: await db.registrationTokens.find().toArray(),
  };
};

describe('операторы запроса в теле — 400 VALIDATION_FAILED, данные не меняются', () => {
  it('refresh, выход, confirm, poll, resend, сброс пароля, вход', async () => {
    const { registrationToken } = RegisterResponse.parse((await register(h)).body);
    await confirm(h, await activeLinkToken(h));
    expect((await poll(h, registrationToken)).status).toBe(200);
    await requestPasswordReset(h, 'rider@example.com');
    const before = await snapshot();

    const attacks: [string, Record<string, unknown>][] = [
      ['/v1/auth/session/refresh', { refreshToken: { $ne: null } }],
      ['/v1/auth/session/sign-out', { refreshToken: { $gt: '' } }],
      ['/v1/auth/verification/confirm', { token: { $gt: '' } }],
      ['/v1/auth/registration/poll', { registrationToken: { $ne: null } }],
      ['/v1/auth/verification/resend', { linkToken: { $ne: null } }],
      ['/v1/auth/password-reset/confirm', { token: { $ne: null }, password: 'long-enough-1' }],
      ['/v1/auth/password-reset', { email: { $ne: null } }],
      ['/v1/auth/session/sign-in', { email: { $ne: null }, password: { $ne: null } }],
    ];
    for (const [url, body] of attacks) {
      const res = await call(h, 'POST', url, body);
      expect(res.status, url).toBe(400);
      expect(res.body, url).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('оператор в пути ссылки — 404 до БД', async () => {
    await register(h);
    for (const url of [
      '/v1/auth/verification/%24ne',
      '/v1/auth/password-reset/%24gt',
      `/v1/auth/verification/${encodeURIComponent('{"$ne":null}')}`,
    ]) {
      const res = await call(h, 'GET', url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
