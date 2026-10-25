import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { AccessTokenVerifier, parseBearer } from './access-token';
import { SessionService } from './session.service';

const secret = 'test-jwt-secret-test-jwt-secret-0000';
const key = new TextEncoder().encode(secret);
const now = new Date('2026-10-25T09:00:00Z');
const userId = uuidv7();
const sessionId = uuidv7();

const verifier = new AccessTokenVerifier({ JWT_SECRET: secret });

/** Access так же, как его выдаёт `SessionService`, с подменой одного параметра. */
function sign(
  overrides: {
    alg?: 'HS256' | 'HS512';
    secret?: string;
    iss?: string;
    aud?: string;
    sub?: string | null;
    sid?: string | null;
    exp?: Date;
  } = {},
) {
  const sid = overrides.sid === undefined ? sessionId : overrides.sid;
  const sub = overrides.sub === undefined ? userId : overrides.sub;
  const jwt = new SignJWT(sid === null ? {} : { sid })
    .setProtectedHeader({ alg: overrides.alg ?? 'HS256', typ: 'JWT' })
    .setIssuer(overrides.iss ?? 'pokatim')
    .setAudience(overrides.aud ?? 'pokatim-app')
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? new Date(now.getTime() + 15 * 60_000));
  if (sub !== null) jwt.setSubject(sub);
  return jwt.sign(overrides.secret ? new TextEncoder().encode(overrides.secret) : key);
}

describe('AccessTokenVerifier', () => {
  it('access, выданный SessionService.issue, — userId и sessionId', async () => {
    const service = new SessionService(
      { insertSession: () => Promise.resolve() } as never,
      { JWT_SECRET: secret } as never,
      { now: () => now },
      {} as never,
    );
    const session = await service.issue({} as never, userId);

    const auth = await verifier.verify(session.accessToken, now);

    expect(auth).toEqual({ userId, sessionId: expect.any(String) });
    expect(auth?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('свой токен с теми же параметрами — проходит (база для отрицательных случаев)', async () => {
    await expect(verifier.verify(await sign(), now)).resolves.toEqual({ userId, sessionId });
  });

  it.each([
    ['HS512', { alg: 'HS512' as const }],
    ['чужой ключ', { secret: 'other-jwt-secret-other-jwt-secret-00' }],
    ['чужой iss', { iss: 'someone' }],
    ['чужой aud', { aud: 'pokatim-admin' }],
    ['без sub', { sub: null }],
    ['без sid', { sid: null }],
    ['sid не UUID', { sid: 'session-1' }],
    ['sub не UUID', { sub: 'user-1' }],
    ['истёк', { exp: new Date(now.getTime() - 1_000) }],
  ])('%s → undefined', async (_name, overrides) => {
    await expect(verifier.verify(await sign(overrides), now)).resolves.toBeUndefined();
  });

  it('alg: none и мусор → undefined', async () => {
    const unsecured = new UnsecuredJWT({ sid: sessionId })
      .setIssuer('pokatim')
      .setAudience('pokatim-app')
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(new Date(now.getTime() + 60_000))
      .encode();
    await expect(verifier.verify(unsecured, now)).resolves.toBeUndefined();
    await expect(verifier.verify('a.b.c', now)).resolves.toBeUndefined();
  });

  it('истечение — по переданному «сейчас» (CLOCK), а не по часам машины', async () => {
    const token = await sign();
    const later = new Date(now.getTime() + 15 * 60_000 + 1_000);
    await expect(verifier.verify(token, later)).resolves.toBeUndefined();
  });
});

describe('parseBearer', () => {
  it('строго `Bearer <jwt>`, длина ≤ 2048', () => {
    expect(parseBearer('Bearer aa.bb.cc')).toBe('aa.bb.cc');
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer('Basic dXNlcjpwYXNz')).toBeUndefined();
    expect(parseBearer('bearer aa.bb.cc')).toBeUndefined();
    expect(parseBearer('Bearer  aa.bb.cc')).toBeUndefined();
    expect(parseBearer('Bearer aa.bb')).toBeUndefined();
    expect(parseBearer('Bearer aa.bb.cc ')).toBeUndefined();
    expect(parseBearer(['Bearer aa.bb.cc'])).toBeUndefined();
    expect(parseBearer(`Bearer ${'a'.repeat(2048)}.b.c`)).toBeUndefined();
  });
});
