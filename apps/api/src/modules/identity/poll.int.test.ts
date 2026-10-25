import { RegisterResponse, RegistrationPollResponse, Session } from '@pokatim/contracts';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { activeLinkToken, collections, confirm, poll, register } from '../../../test/identity';
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

async function registered() {
  const res = await register(h);
  return RegisterResponse.parse(res.body).registrationToken;
}

describe('POST /v1/auth/registration/poll', () => {
  it('до подтверждения — pending, сессии нет', async () => {
    const token = await registered();
    const res = await poll(h, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'pending' });
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });

  it('после подтверждения — verified + сессия ровно один раз; повтор — 401', async () => {
    const token = await registered();
    await confirm(h, await activeLinkToken(h));

    const res = await poll(h, token);

    expect(res.status).toBe(200);
    const body = RegistrationPollResponse.parse(res.body);
    if (body.state !== 'verified') throw new Error('expected verified');
    const db = collections(h);
    const [user] = await db.users.find().toArray();
    const { payload } = await jwtVerify(
      body.session.accessToken,
      new TextEncoder().encode(h.env.JWT_SECRET),
      { issuer: 'pokatim', audience: 'pokatim-app', currentDate: h.clock.now() },
    );
    expect(payload.sub).toBe(user?._id);
    const [session] = await db.sessions.find().toArray();
    expect(payload.sid).toBe(session?._id);
    // без sessionTransport — прежний ответ native: полный Session с refreshToken в теле
    expect(session?.refreshTokenHash).toBe(sha256(Session.parse(body.session).refreshToken));
    const [registration] = await db.registrationTokens.find().toArray();
    expect(registration?.consumedAt).toEqual(h.clock.now());

    const again = await poll(h, token);
    expect(again.status).toBe(401);
    expect(again.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await db.sessions.countDocuments()).toBe(1);
  });

  it('параллельный обмен — одна сессия, остальные 401', async () => {
    const token = await registered();
    await confirm(h, await activeLinkToken(h));

    const results = await Promise.all(Array.from({ length: 5 }, () => poll(h, token)));

    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401, 401, 401]);
    expect(await collections(h).sessions.countDocuments()).toBe(1);
  });

  it('просроченный (24 ч без повтора) и неизвестный токен — 401', async () => {
    const token = await registered();
    expect((await poll(h, randomToken())).status).toBe(401);
    h.clock.advance(DAY);
    expect((await poll(h, token)).status).toBe(401);
  });
});
