import { ApiError, RegisterResponse, VerificationLinkInfo } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, MINUTE, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  collections,
  confirm,
  register,
  resend,
} from '../../../test/identity';
import { randomToken } from './tokens';

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

const describeLink = (token: string) => call(h, 'GET', `/v1/auth/verification/${token}`);
const snapshot = async () => ({
  users: await collections(h).users.find().toArray(),
  tokens: await collections(h).emailVerificationTokens.find().toArray(),
});

async function registered() {
  const res = await register(h);
  return {
    registrationToken: RegisterResponse.parse(res.body).registrationToken,
    link: await activeLinkToken(h),
  };
}

describe('GET /v1/auth/verification/:token', () => {
  it('valid + e-mail и ничего не меняет', async () => {
    const { link } = await registered();
    const before = await snapshot();

    const res = await describeLink(link);

    expect(res.status).toBe(200);
    expect(VerificationLinkInfo.parse(res.body)).toEqual({
      state: 'valid',
      email: 'rider@example.com',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('expired через 24 часа; verified после подтверждения (важнее expired)', async () => {
    const { link } = await registered();
    h.clock.advance(DAY);
    expect((await describeLink(link)).body).toEqual({
      state: 'expired',
      email: 'rider@example.com',
    });

    await collections(h).users.updateMany({}, { $set: { emailVerifiedAt: h.clock.now() } });
    expect((await describeLink(link)).body).toEqual({
      state: 'verified',
      email: 'rider@example.com',
    });
  });

  it('неизвестный и мусорный токен — 404 NOT_FOUND', async () => {
    await registered();
    expect((await describeLink(randomToken())).status).toBe(404);
    const garbage = await describeLink('not-a-token');
    expect(garbage.status).toBe(404);
    expect(ApiError.parse(garbage.body).code).toBe('NOT_FOUND');
  });
});

describe('POST /v1/auth/verification/confirm', () => {
  it('активирует аккаунт и гасит ссылку; повтор — 200 (идемпотентно)', async () => {
    const { link } = await registered();

    const first = await confirm(h, link);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ state: 'verified', email: 'rider@example.com' });
    const [user] = await collections(h).users.find().toArray();
    expect(user?.emailVerifiedAt).toEqual(h.clock.now());
    const [token] = await collections(h).emailVerificationTokens.find().toArray();
    expect(token?.usedAt).toEqual(h.clock.now());

    h.clock.advance(DAY * 2);
    const again = await confirm(h, link);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ state: 'verified', email: 'rider@example.com' });
    const [unchanged] = await collections(h).users.find().toArray();
    expect(unchanged?.emailVerifiedAt).toEqual(user?.emailVerifiedAt);
  });

  it('просроченная ссылка — 410 LINK_EXPIRED с e-mail, аккаунт не активируется', async () => {
    const { link } = await registered();
    h.clock.advance(DAY);

    const res = await confirm(h, link);

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      code: 'LINK_EXPIRED',
      message: 'Ссылка устарела',
      details: { email: 'rider@example.com' },
    });
    const [user] = await collections(h).users.find().toArray();
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it('заменённая новой ссылкой — 410; новая — работает', async () => {
    const { registrationToken, link: old } = await registered();
    h.clock.advance(MINUTE);
    expect((await resend(h, { registrationToken })).status).toBe(200);
    const fresh = await activeLinkToken(h);
    expect(fresh).not.toBe(old);

    expect((await confirm(h, old)).status).toBe(410);
    expect((await confirm(h, fresh)).status).toBe(200);
  });

  it('неизвестный токен — 404, некорректное тело — 400', async () => {
    expect((await confirm(h, randomToken())).status).toBe(404);
    expect((await call(h, 'POST', '/v1/auth/verification/confirm', { token: 'x' })).status).toBe(
      400,
    );
  });

  it('параллельные подтверждения: все 200, активация одна', async () => {
    const { link } = await registered();
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(h, link)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const tokens = await collections(h).emailVerificationTokens.find().toArray();
    expect(tokens.filter((t) => t.usedAt !== null)).toHaveLength(1);
  });
});

describe('POST /v1/auth/verification/resend', () => {
  it('регистрация — первое письмо: повтор раньше 60 с — 429 с остатком', async () => {
    const { registrationToken } = await registered();
    h.clock.advance(20_000);

    const res = await resend(h, { registrationToken });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 40 } });
    expect(res.headers['retry-after']).toBe('40');
  });

  it('через 60 с — новая ссылка, прежняя заменена, письмо поставлено в outbox', async () => {
    const { registrationToken, link: old } = await registered();
    h.clock.advance(MINUTE);

    const res = await resend(h, { registrationToken });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resendAvailableInSec: 60 });
    expect((await describeLink(old)).body).toMatchObject({ state: 'expired' });
    expect((await describeLink(await activeLinkToken(h))).body).toMatchObject({ state: 'valid' });
    const tokens = await collections(h).emailVerificationTokens.find().toArray();
    expect(tokens.filter((t) => t.supersededAt === null)).toHaveLength(1);
  });

  it('не больше 10 писем за сутки (включая письмо регистрации)', async () => {
    const { registrationToken } = await registered();
    for (let i = 1; i < 10; i += 1) {
      h.clock.advance(MINUTE);
      expect((await resend(h, { registrationToken })).status).toBe(200);
    }
    h.clock.advance(MINUTE);
    const res = await resend(h, { registrationToken });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ details: { retryAfterSec: DAY / 1000 - 10 * 60 } });
  });

  it('по устаревшей ссылке — новая ссылка; токен регистрации продлевается до её срока', async () => {
    const { registrationToken } = await registered();
    h.clock.advance(DAY - MINUTE);
    const link = await activeLinkToken(h);

    const res = await resend(h, { linkToken: link });
    expect(res.status).toBe(200);

    // через сутки после регистрации токен регистрации ещё жив — скользящий TTL
    h.clock.advance(2 * MINUTE);
    expect(
      (await call(h, 'POST', '/v1/auth/registration/poll', { registrationToken })).body,
    ).toEqual({
      state: 'pending',
    });
  });

  it('уже подтверждён — state: verified, без нового письма', async () => {
    const { registrationToken, link } = await registered();
    await confirm(h, link);
    h.clock.advance(MINUTE);

    expect((await resend(h, { registrationToken })).body).toEqual({ state: 'verified' });
    expect((await resend(h, { linkToken: link })).body).toEqual({ state: 'verified' });
    expect(await collections(h).emailVerificationTokens.countDocuments()).toBe(1);
  });

  it('чужой или просроченный токен регистрации — 401; неизвестная ссылка — 404', async () => {
    const { registrationToken } = await registered();
    expect((await resend(h, { registrationToken: randomToken() })).status).toBe(401);
    expect((await resend(h, { linkToken: randomToken() })).status).toBe(404);
    h.clock.advance(DAY);
    expect((await resend(h, { registrationToken })).status).toBe(401);
  });

  it('удалённый аккаунт — ссылка больше не действует (404)', async () => {
    const { link } = await registered();
    await collections(h).users.updateOne(
      { email: 'rider@example.com' },
      { $set: { deletedAt: h.clock.now() } },
    );
    expect((await describeLink(link)).status).toBe(404);
    expect((await confirm(h, link)).status).toBe(404);
  });
});
