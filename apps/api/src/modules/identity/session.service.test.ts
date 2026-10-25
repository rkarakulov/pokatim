import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { sha256 } from './tokens';
import { SessionService } from './session.service';

const secret = 'test-jwt-secret-test-jwt-secret-0000';
const now = new Date('2026-10-22T09:00:00Z');
// sid — UUID v7 (`uuidv7()` базы): от него выводится claim access и _id сессии
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('SessionService', () => {
  it('access JWT HS256 (iss, aud, sub, sid, exp 15 мин) и refresh на 30 дней, в БД — только хеш', async () => {
    const inserted: unknown[] = [];
    const repository = {
      insertSession: (_tx: unknown, row: unknown) => {
        inserted.push(row);
        return Promise.resolve();
      },
    };
    const service = new SessionService(
      repository as never,
      { JWT_SECRET: secret } as never,
      { now: () => now },
      {} as never,
    );

    const session = await service.issue({} as never, 'user-1');

    expect(session.accessTokenExpiresAt).toBe('2026-10-22T09:15:00.000Z');
    expect(session.refreshTokenExpiresAt).toBe('2026-11-21T09:00:00.000Z');
    const { payload, protectedHeader } = await jwtVerify(
      session.accessToken,
      new TextEncoder().encode(secret),
      { issuer: 'pokatim', audience: 'pokatim-app', currentDate: now },
    );
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload).toMatchObject({
      sub: 'user-1',
      sid: expect.stringMatching(UUID_V7),
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 15 * 60,
    });
    expect(inserted).toEqual([
      {
        id: payload.sid,
        userId: 'user-1',
        refreshTokenHash: sha256(session.refreshToken),
        createdAt: now,
        expiresAt: new Date('2026-11-21T09:00:00.000Z'),
      },
    ]);
  });
});
