import 'reflect-metadata';

import { Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { SESSION_COOKIE, type Session } from '@pokatim/contracts';
import { CLOCK, createFastifyAdapter } from '@rkarakulov/api-kit/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SessionCookie } from './session-cookie';

const now = new Date('2026-10-23T09:00:00Z');
const session: Session = {
  accessToken: 'access',
  accessTokenExpiresAt: '2026-10-23T09:15:00.000Z',
  refreshToken: 'r'.repeat(43),
  // остаток срока — 10 дней и полсекунды: Max-Age в целых секундах, вниз
  refreshTokenExpiresAt: '2026-11-02T09:00:00.500Z',
};

@Controller('cookie')
class CookieProbeController {
  constructor(private readonly cookie: SessionCookie) {}

  @Post('cookie')
  @HttpCode(200)
  viaCookie(@Res({ passthrough: true }) reply: unknown): unknown {
    return this.cookie.deliver(reply, session, 'cookie');
  }

  @Post('body')
  @HttpCode(200)
  viaBody(@Res({ passthrough: true }) reply: unknown): unknown {
    return this.cookie.deliver(reply, session, 'body');
  }

  @Post('clear')
  @HttpCode(204)
  clear(@Res({ passthrough: true }) reply: unknown): void {
    this.cookie.noStore(reply);
    this.cookie.clear(reply);
  }
}

let app: NestFastifyApplication;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [CookieProbeController],
    providers: [SessionCookie, { provide: CLOCK, useValue: { now: () => now } }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ TRUST_PROXY: 0 }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

const attributes = (header: string) => header.split('; ').slice(1).sort();
/** Единственный Set-Cookie ответа (адаптер Nest добавляет заголовок через appendHeader). */
function onlySetCookie(header: unknown): string {
  const all = Array.isArray(header) ? header : [header];
  expect(all).toHaveLength(1);
  return String(all[0]);
}

describe('SessionCookie', () => {
  it('cookie: refresh — в HttpOnly Secure SameSite=Strict cookie с узким Path, без Domain; в теле его нет', async () => {
    const res = await app.inject({ method: 'POST', url: '/cookie/cookie' });

    expect(res.json()).toEqual({
      accessToken: 'access',
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    });
    const value = onlySetCookie(res.headers['set-cookie']);
    expect(value.startsWith(`${SESSION_COOKIE.name}=${session.refreshToken}; `)).toBe(true);
    expect(SESSION_COOKIE).toEqual({ name: '__Secure-pokatim_rt', path: '/v1/auth/session' });
    expect(attributes(value)).toEqual(
      [
        `Max-Age=${10 * 24 * 60 * 60}`,
        'Path=/v1/auth/session',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ].sort(),
    );
    expect(value).not.toMatch(/domain=/i);
  });

  it('body (native): прежний Session целиком, cookie не ставится', async () => {
    const res = await app.inject({ method: 'POST', url: '/cookie/body' });
    expect(res.json()).toEqual(session);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('clear — те же Path и Secure (иначе браузер не заменит __Secure- cookie), срок истёк; no-store', async () => {
    const res = await app.inject({ method: 'POST', url: '/cookie/clear' });
    const value = onlySetCookie(res.headers['set-cookie']);
    expect(value.startsWith(`${SESSION_COOKIE.name}=; `)).toBe(true);
    expect(attributes(value)).toEqual(
      expect.arrayContaining([
        'Max-Age=0',
        'Path=/v1/auth/session',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ]),
    );
    expect(value).not.toMatch(/domain=/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
