/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { CookieSession } from '@pokatim/contracts';

import { fakeAccessToken, SID_B, USER_B } from '@/__tests__/jwt';
import { api } from '@/lib/api';

import { UnauthorizedError, withAccessToken } from './authorized';
import { resetSessionStore, useSessionStore } from './session-store';

jest.mock('@/lib/api', () => ({ api: { refreshSession: jest.fn(), signOut: jest.fn() } }));

const refresh = jest.mocked(api.refreshSession);
const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const tagOf = (token: string) => token.split('.')[2];

/** Сессия web (без refresh) аккаунта A с меткой access `tag`; `claims` — другой аккаунт/сессия. */
const cookieSession = (tag: string, accessMinutes: number, claims = {}): CookieSession => {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: fakeAccessToken({ iat: now, exp: now + accessMinutes * 60, ...claims }, tag),
    accessTokenExpiresAt: inMinutes(accessMinutes),
    refreshTokenExpiresAt: inMinutes(30 * 24 * 60),
  };
};

const lockRequest = jest.fn((_name: string, task: () => Promise<unknown>) => task());

beforeEach(() => {
  resetSessionStore();
  localStorage.clear();
  refresh.mockReset();
  lockRequest.mockClear();
  Object.defineProperty(navigator, 'locks', {
    value: { request: lockRequest },
    configurable: true,
  });
  useSessionStore.setState({ status: 'signedIn', session: cookieSession('a1', 10) });
});

describe('withAccessToken (web): refresh по cookie под Web Lock', () => {
  it('401 → refresh по cookie (без тела) под замком сессии → повтор с новым access', async () => {
    refresh.mockResolvedValueOnce(cookieSession('a2', 15));
    const call = jest.fn(async (token: string) => {
      if (tagOf(token) === 'a1') throw unauthorized();
      return tagOf(token);
    });

    await expect(withAccessToken(call)).resolves.toBe('a2');
    expect(refresh).toHaveBeenCalledWith();
    expect(lockRequest).toHaveBeenCalledWith('pokatim.session-refresh', expect.any(Function));
    expect(tagOf(useSessionStore.getState().session?.accessToken ?? '')).toBe('a2');
  });

  it('ответ refresh с refreshToken — в памяти его нет', async () => {
    useSessionStore.setState({ session: cookieSession('a1', 0.5) });
    refresh.mockResolvedValueOnce({ ...cookieSession('a2', 15), refreshToken: 'r'.repeat(43) });

    await withAccessToken(async (token) => token);

    expect(useSessionStore.getState().session).not.toHaveProperty('refreshToken');
  });

  it('cookie уже другого аккаунта (другая вкладка вошла как B): refresh вернул B — выход, без повтора от имени B', async () => {
    refresh.mockResolvedValueOnce(cookieSession('b1', 15, { sub: USER_B, sid: SID_B }));
    const call = jest.fn(async (token: string) => {
      if (tagOf(token) === 'a1') throw unauthorized();
      return tagOf(token);
    });

    await expect(withAccessToken(call)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      returning: true,
    });
  });

  it('refresh 401 → выход (returning), UnauthorizedError', async () => {
    useSessionStore.setState({ session: cookieSession('a1', 0.5) });
    refresh.mockRejectedValueOnce(unauthorized());

    await expect(withAccessToken(jest.fn())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', returning: true });
  });

  it('незавершённый выход (признак) — refresh не идёт, выход', async () => {
    useSessionStore.setState({ session: cookieSession('a1', 0.5) });
    localStorage.setItem('pokatim.signOutPending', '1');

    await expect(withAccessToken(jest.fn())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refresh без сети — ошибка запроса, сессия остаётся', async () => {
    useSessionStore.setState({ session: cookieSession('a1', 0.5) });
    const offline = new ApiNetworkError(new TypeError('Failed to fetch'));
    refresh.mockRejectedValueOnce(offline);

    await expect(withAccessToken(jest.fn())).rejects.toBe(offline);
    expect(useSessionStore.getState().status).toBe('signedIn');
  });
});
