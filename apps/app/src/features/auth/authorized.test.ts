/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { Session } from '@pokatim/contracts';

import { api } from '@/lib/api';

import { UnauthorizedError, withAccessToken } from './authorized';
import { useSessionStore } from './session-store';

jest.mock('@/lib/api', () => ({ api: { refreshSession: jest.fn() } }));

const refresh = jest.mocked(api.refreshSession);
const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

function sessionWith(accessToken: string, accessMinutes: number): Session {
  return {
    accessToken,
    accessTokenExpiresAt: inMinutes(accessMinutes),
    refreshToken: `${accessToken}-refresh`.padEnd(43, 'x'),
    refreshTokenExpiresAt: inMinutes(30 * 24 * 60),
  };
}

/** Вошедший пользователь: сессия в SecureStore и в памяти (без refresh). */
function signedIn(session: Session) {
  store().set('pokatim.session', JSON.stringify(session));
  const { refreshToken: _refresh, ...inMemory } = session;
  useSessionStore.setState({ status: 'signedIn', session: inMemory });
}

beforeEach(() => {
  refresh.mockReset();
});

describe('withAccessToken (native)', () => {
  it('живой access — запрос с ним, без ротации', async () => {
    signedIn(sessionWith('a1', 10));
    const call = jest.fn(async (token: string) => token);

    await expect(withAccessToken(call)).resolves.toBe('a1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('access истекает меньше чем через 60 с — обновление до запроса, новый refresh сохранён', async () => {
    const old = sessionWith('a1', 0.5);
    signedIn(old);
    const next = sessionWith('a2', 15);
    refresh.mockResolvedValueOnce(next);
    const call = jest.fn(async (token: string) => token);

    await expect(withAccessToken(call)).resolves.toBe('a2');
    expect(call).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ refreshToken: old.refreshToken });
    expect(JSON.parse(store().get('pokatim.session') ?? '')).toEqual(next);
    expect(useSessionStore.getState().session?.accessToken).toBe('a2');
  });

  it('401 — одно обновление и один повтор с новым access', async () => {
    signedIn(sessionWith('a1', 10));
    refresh.mockResolvedValueOnce(sessionWith('a2', 15));
    const call = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(unauthorized())
      .mockImplementation(async (token) => token);

    await expect(withAccessToken(call)).resolves.toBe('a2');
    expect(call.mock.calls.map(([token]) => token)).toEqual(['a1', 'a2']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('повтор тоже 401 — ошибка, третьей попытки нет', async () => {
    signedIn(sessionWith('a1', 10));
    refresh.mockResolvedValueOnce(sessionWith('a2', 15));
    const call = jest.fn<Promise<string>, [string]>().mockRejectedValue(unauthorized());

    await expect(withAccessToken(call)).rejects.toBeInstanceOf(ApiHttpError);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('два параллельных запроса с 401 — одна ротация refresh', async () => {
    signedIn(sessionWith('a1', 10));
    refresh.mockResolvedValue(sessionWith('a2', 15));
    const call = jest.fn(async (token: string) => {
      if (token === 'a1') throw unauthorized();
      return token;
    });

    await expect(Promise.all([withAccessToken(call), withAccessToken(call)])).resolves.toEqual([
      'a2',
      'a2',
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh 401 — локальный выход (returning), UnauthorizedError, сессия забыта', async () => {
    signedIn(sessionWith('a1', 0.5));
    refresh.mockRejectedValueOnce(unauthorized());
    const call = jest.fn(async (token: string) => token);

    await expect(withAccessToken(call)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(call).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      returning: true,
    });
    expect(store().has('pokatim.session')).toBe(false);
  });

  it('refresh без сети — ошибка запроса, сессия остаётся', async () => {
    const session = sessionWith('a1', 0.5);
    signedIn(session);
    const offline = new ApiNetworkError(new TypeError('Network request failed'));
    refresh.mockRejectedValue(offline);

    await expect(withAccessToken(jest.fn())).rejects.toBe(offline);
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(JSON.parse(store().get('pokatim.session') ?? '')).toEqual(session);
  });

  it('без сессии — UnauthorizedError без запроса', async () => {
    const call = jest.fn();
    await expect(withAccessToken(call)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(call).not.toHaveBeenCalled();
  });
});
