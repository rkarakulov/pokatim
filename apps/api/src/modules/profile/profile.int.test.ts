import type { Session } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';

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

const PROFILE = '/v1/profile';
const getProfile = (session: Session) =>
  call(h, 'GET', PROFILE, undefined, bearer(session.accessToken));
const submit = (session: Session, reasons: string[]) =>
  call(h, 'PUT', '/v1/profile/onboarding/survey', { reasons }, bearer(session.accessToken));

describe('GET /v1/profile (AC2)', () => {
  it('документа нет → { rideReasons: [] }, no-store', async () => {
    const session = await signUpSession(h);
    const res = await getProfile(session);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rideReasons: [] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('после опроса — ответы своего пользователя в порядке ответа', async () => {
    const session = await signUpSession(h);
    await submit(session, ['calendar', 'races']);
    const res = await getProfile(session);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rideReasons: ['calendar', 'races'] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ответы одного пользователя не видны другому', async () => {
    const mine = await signUpSession(h, 'rider@example.com');
    const other = await signUpSession(h, 'other@example.com');
    await submit(mine, ['routes']);
    expect((await getProfile(other)).body).toEqual({ rideReasons: [] });
  });

  it('без access → 401 UNAUTHORIZED', async () => {
    const res = await call(h, 'GET', PROFILE);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('сессия отозвана выходом → 401 UNAUTHORIZED', async () => {
    const session = await signUpSession(h);
    await call(h, 'POST', '/v1/auth/session/sign-out', { refreshToken: session.refreshToken });
    const res = await getProfile(session);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
