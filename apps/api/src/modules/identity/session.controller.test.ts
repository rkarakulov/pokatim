import 'reflect-metadata';

import { FieldErrorCode, SignInRequest } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';
import { describe, expect, it, vi } from 'vitest';

import { SessionController } from './session.controller';
import type { SessionCookie } from './session-cookie';
import type { SessionService } from './session.service';
import type { SignInService } from './sign-in.service';

function createController() {
  const sessions = { rotate: vi.fn(), revoke: vi.fn(() => Promise.resolve()) };
  const signIn = { signIn: vi.fn() };
  const cookie = { deliver: vi.fn((_reply, session) => session), clear: vi.fn(), noStore: vi.fn() };
  const controller = new SessionController(
    sessions as unknown as SessionService,
    signIn as unknown as SignInService,
    cookie as unknown as SessionCookie,
  );
  return { controller, sessions, signIn, cookie };
}

const LIVE_COOKIE = 'c'.repeat(43);
const session = {
  accessToken: 'jwt',
  accessTokenExpiresAt: '2026-10-24T10:15:00.000Z',
  refreshToken: 'r'.repeat(43),
  refreshTokenExpiresAt: '2026-11-23T10:00:00.000Z',
};
const credentials = { email: 'rider@example.com', password: 'velo-secret' };

describe('SessionController.signIn: транспорт и прежняя cookie', () => {
  it('тело не по контракту — 400 VALIDATION_FAILED в pipe, до сервиса', () => {
    const pipe = new ZodValidationPipe(SignInRequest, FieldErrorCode);
    for (const body of [{ email: 'a@b.by' }, { ...credentials, extra: 1 }, 'garbage']) {
      expect(() => pipe.transform(body)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }),
      );
    }
  });

  it('успех с живой cookie прежней сессии — она отзывается (superseded), новая доставляется по транспорту', async () => {
    const { controller, sessions, signIn, cookie } = createController();
    signIn.signIn.mockResolvedValue({ state: 'signedIn', session });

    await controller.signIn(
      { ...credentials, sessionTransport: 'cookie' },
      LIVE_COOKIE,
      '1.2.3.4',
      {},
    );

    expect(signIn.signIn).toHaveBeenCalledWith(
      { ...credentials, sessionTransport: 'cookie' },
      '1.2.3.4',
    );
    expect(sessions.revoke).toHaveBeenCalledWith(LIVE_COOKIE, 'superseded');
    expect(cookie.deliver).toHaveBeenCalledWith({}, session, 'cookie');
    expect(cookie.noStore).toHaveBeenCalled();
  });

  it('сбой отзыва прежней сессии вход не отменяет; без транспорта — body', async () => {
    const { controller, sessions, signIn, cookie } = createController();
    signIn.signIn.mockResolvedValue({ state: 'signedIn', session });
    sessions.revoke.mockRejectedValueOnce(new Error('db down'));

    await expect(controller.signIn(credentials, LIVE_COOKIE, '1.2.3.4', {})).resolves.toEqual({
      state: 'signedIn',
      session,
    });
    expect(cookie.deliver).toHaveBeenCalledWith({}, session, 'body');
  });

  it('отказ входа (401/429) и verificationRequired — cookie не трогаем, сессий не отзываем', async () => {
    const { controller, sessions, signIn, cookie } = createController();
    signIn.signIn.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    await expect(controller.signIn(credentials, LIVE_COOKIE, '1.2.3.4', {})).rejects.toThrow();

    const pending = {
      state: 'verificationRequired',
      registrationToken: 't'.repeat(43),
      email: credentials.email,
      resendAvailableInSec: 0,
    };
    signIn.signIn.mockResolvedValueOnce(pending);
    await expect(controller.signIn(credentials, LIVE_COOKIE, '1.2.3.4', {})).resolves.toEqual(
      pending,
    );

    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(cookie.deliver).not.toHaveBeenCalled();
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('мусор в cookie при входе — отзыва нет', async () => {
    const { controller, sessions, signIn } = createController();
    signIn.signIn.mockResolvedValue({ state: 'signedIn', session });
    await controller.signIn(credentials, 'garbage', '1.2.3.4', {});
    expect(sessions.revoke).not.toHaveBeenCalled();
  });
});

describe('SessionController: cookie валидируется схемой до сервиса', () => {
  it('refresh без cookie → 401 без сброса: запоздалый ответ не сотрёт cookie, выданную тем временем poll', async () => {
    const { controller, sessions, cookie } = createController();

    await expect(controller.refresh({}, undefined, '1.2.3.4', {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(sessions.rotate).not.toHaveBeenCalled();
    expect(cookie.noStore).toHaveBeenCalled();
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it.each([
    ['пустая cookie', ''],
    ['мусор', 'not-a-token'],
    ['почти токен (42 символа)', 'a'.repeat(42)],
  ])(
    'refresh, %s → 401 и сброс cookie, без ротации (ни лимита, ни запроса в БД)',
    async (_case, value) => {
      const { controller, sessions, cookie } = createController();

      await expect(controller.refresh({}, value, '1.2.3.4', {})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      });
      expect(sessions.rotate).not.toHaveBeenCalled();
      expect(cookie.noStore).toHaveBeenCalled();
      expect(cookie.clear).toHaveBeenCalled();
    },
  );

  it('sign-out с мусором в cookie → без отзыва, cookie сброшена', async () => {
    const { controller, sessions, cookie } = createController();

    await expect(controller.signOut({}, 'not-a-token', {})).resolves.toBeUndefined();
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(cookie.clear).toHaveBeenCalled();
  });
});
