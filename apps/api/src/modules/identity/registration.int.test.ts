import { ApiError, RegisterResponse, ValidationErrorDetails } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  call,
  collections,
  outboxEvents,
  register,
  validRegistration,
} from '../../../test/identity';
import { sha256 } from './tokens';

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

describe('POST /v1/auth/register', () => {
  it('201: неактивный аккаунт, согласия, ссылка, токен регистрации, событие на письмо', async () => {
    const res = await register(h, { email: '  Rider@Example.COM ' });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = RegisterResponse.parse(res.body);
    expect(body).toEqual({
      registrationToken: expect.any(String),
      email: 'rider@example.com',
      resendAvailableInSec: 60,
    });

    const db = collections(h);
    const [user] = await db.users.find().toArray();
    expect(user).toMatchObject({
      email: 'rider@example.com',
      birthDate: '1990-05-01',
      emailVerifiedAt: null,
      deletedAt: null,
      createdAt: h.clock.now(),
      version: 0,
    });
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);

    const consents = await db.userConsents.find().toArray();
    expect(consents.map((c) => [c.kind, c.version, c.acceptedAt])).toEqual(
      expect.arrayContaining([
        ['personal_data', 'test-agreement', h.clock.now()],
        ['agreement', 'test-agreement', h.clock.now()],
      ]),
    );

    const [link] = await db.emailVerificationTokens.find().toArray();
    expect(link?.expiresAt).toEqual(new Date(h.clock.now().getTime() + 24 * 3600_000));

    const [registration] = await db.registrationTokens.find().toArray();
    expect(registration?.tokenHash).toBe(sha256(body.registrationToken));
    expect(registration?.expiresAt).toEqual(link?.expiresAt);

    // в outbox — только id ссылки: ни токенов, ни e-mail
    const events = await outboxEvents(h);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'identity.verification-email-requested',
        payload: { verificationTokenId: link?._id },
        publishedAt: null,
      }),
    ]);
    expect(await db.sessions.countDocuments()).toBe(0);
  });

  it('400 VALIDATION_FAILED с кодами полей: младше 18, без согласия, короткий пароль', async () => {
    const res = await call(h, 'POST', '/v1/auth/register', {
      ...validRegistration(),
      birthDate: '2015-01-01',
      personalDataConsent: false,
      password: 'short',
    });

    expect(res.status).toBe(400);
    const error = ApiError.parse(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(ValidationErrorDetails.parse(error.details).fields).toEqual(
      expect.arrayContaining([
        { path: 'password', code: 'TOO_SHORT' },
        { path: 'birthDate', code: 'AGE_BELOW_18' },
        { path: 'personalDataConsent', code: 'CONSENT_REQUIRED' },
      ]),
    );
    expect(JSON.stringify(res.body)).not.toContain('short');
    expect(await collections(h).users.countDocuments()).toBe(0);
  });

  it('409 EMAIL_TAKEN — адрес занят (без учёта регистра), даже неподтверждённым', async () => {
    expect((await register(h)).status).toBe(201);
    const res = await register(h, { email: 'RIDER@example.com' });
    expect(res.status).toBe(409);
    expect(ApiError.parse(res.body)).toEqual({
      code: 'EMAIL_TAKEN',
      message: 'E-mail уже зарегистрирован',
    });
  });

  it('409 EMAIL_UNAVAILABLE — адрес удалённого аккаунта, без раскрытия причины', async () => {
    await register(h);
    await collections(h).users.updateOne(
      { email: 'rider@example.com' },
      { $set: { deletedAt: h.clock.now() } },
    );

    const res = await register(h);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'EMAIL_UNAVAILABLE',
      message: 'E-mail недоступен для регистрации',
    });
  });

  it('параллельная регистрация одного адреса: один 201, остальные 409 EMAIL_TAKEN', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => register(h)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).map((r) => ApiError.parse(r.body).code)).toEqual(
      ['EMAIL_TAKEN', 'EMAIL_TAKEN', 'EMAIL_TAKEN'],
    );
    expect(await collections(h).users.countDocuments()).toBe(1);
  });

  it('429 RATE_LIMITED с Retry-After после 20 регистраций с одного IP за час', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await register(h, { email: `rider${i}@example.com` })).status).toBe(201);
    }
    const res = await register(h, { email: 'one-more@example.com' });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 3600 } });
    expect(res.headers['retry-after']).toBe('3600');
  });
});

describe('единый формат ошибок', () => {
  it('битый JSON — 400 ApiError', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).code).toBe('VALIDATION_FAILED');
  });

  it('неизвестный путь — 404 ApiError', async () => {
    const res = await call(h, 'GET', '/v1/nope');
    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body).code).toBe('NOT_FOUND');
  });
});
