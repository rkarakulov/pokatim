/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { Session } from '@pokatim/contracts';

import { fakeAccessToken, SID_B, USER_B } from '@/__tests__/jwt';
import { api } from '@/lib/api';

import { UnauthorizedError, withAccessToken } from './authorized';
import { useSessionStore } from './session-store';

jest.mock('@/lib/api', () => ({ api: { refreshSession: jest.fn() } }));

const refresh = jest.mocked(api.refreshSession);
const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const seconds = (date: number) => Math.floor(date / 1000);

/** Access аккаунта A с меткой `tag` и сроком `accessMinutes` от «сейчас» (по часам устройства). */
const A1 = 'a1';
const A2 = 'a2';
function sessionWith(tag: string, accessMinutes: number, claims = {}): Session {
  const now = seconds(Date.now());
  return {
    accessToken: fakeAccessToken({ iat: now, exp: now + accessMinutes * 60, ...claims }, tag),
    accessTokenExpiresAt: inMinutes(accessMinutes),
    refreshToken: `${tag}-refresh`.padEnd(43, 'x'),
    refreshTokenExpiresAt: inMinutes(30 * 24 * 60),
  };
}
const tagOf = (token: string) => token.split('.')[2];

/** Вошедший пользователь: сессия в SecureStore и в памяти (без refresh). */
function signedIn(session: Session) {
  store().set('pokatim.session', JSON.stringify(session));
  const { refreshToken: _refresh, ...inMemory } = session;
  useSessionStore.setState({ status: 'signedIn', session: inMemory, sessionReceivedAt: null });
}

/** Промис, который тест завершает сам. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  refresh.mockReset();
});

describe('withAccessToken (native)', () => {
  it('живой access — запрос с ним, без ротации', async () => {
    signedIn(sessionWith(A1, 10));
    await expect(withAccessToken(async (token) => tagOf(token))).resolves.toBe(A1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('access истекает меньше чем через 60 с — обновление до запроса, новый refresh сохранён', async () => {
    const old = sessionWith(A1, 0.5);
    signedIn(old);
    const next = sessionWith(A2, 15);
    refresh.mockResolvedValueOnce(next);
    const call = jest.fn(async (token: string) => tagOf(token));

    await expect(withAccessToken(call)).resolves.toBe(A2);
    expect(call).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ refreshToken: old.refreshToken });
    expect(JSON.parse(store().get('pokatim.session') ?? '')).toEqual(next);
    expect(useSessionStore.getState().session?.accessToken).toBe(next.accessToken);
  });

  it('часы устройства спешат: остаток access — по сроку жизни от сервера и моменту получения, без лишней ротации', async () => {
    // сервер выдал access на 15 мин, а часы устройства убежали на 14,5 мин вперёд: по accessTokenExpiresAt
    // «осталось 30 с», хотя сессия получена только что
    const serverNow = seconds(Date.now()) - 14.5 * 60;
    const skewed: Session = {
      ...sessionWith(A1, 0.5, { iat: serverNow, exp: serverNow + 15 * 60 }),
    };
    const { refreshToken: _refresh, ...inMemory } = skewed;
    store().set('pokatim.session', JSON.stringify(skewed));
    await useSessionStore.getState().signIn(inMemory);

    await expect(withAccessToken(async (token) => tagOf(token))).resolves.toBe(A1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('401 — одно обновление и один повтор с новым access', async () => {
    signedIn(sessionWith(A1, 10));
    refresh.mockResolvedValueOnce(sessionWith(A2, 15));
    const call = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(unauthorized())
      .mockImplementation(async (token) => tagOf(token));

    await expect(withAccessToken(call)).resolves.toBe(A2);
    expect(call.mock.calls.map(([token]) => tagOf(token))).toEqual([A1, A2]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('повтор тоже 401 — ошибка, третьей попытки нет', async () => {
    signedIn(sessionWith(A1, 10));
    refresh.mockResolvedValueOnce(sessionWith(A2, 15));
    const call = jest.fn<Promise<string>, [string]>().mockRejectedValue(unauthorized());

    await expect(withAccessToken(call)).rejects.toBeInstanceOf(ApiHttpError);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('два параллельных запроса с 401 — одна ротация refresh', async () => {
    signedIn(sessionWith(A1, 10));
    refresh.mockResolvedValue(sessionWith(A2, 15));
    const call = jest.fn(async (token: string) => {
      if (tagOf(token) === A1) throw unauthorized();
      return tagOf(token);
    });

    await expect(Promise.all([withAccessToken(call), withAccessToken(call)])).resolves.toEqual([
      A2,
      A2,
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh 401 — локальный выход (returning), UnauthorizedError, сессия забыта', async () => {
    signedIn(sessionWith(A1, 0.5));
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
    const session = sessionWith(A1, 0.5);
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

describe('withAccessToken: смена аккаунта во время запроса', () => {
  const accountB = () => sessionWith('b1', 15, { sub: USER_B, sid: SID_B });

  it('запрос A ждёт ответа, вошёл B, ответ A — 401: повтора от имени B нет, UnauthorizedError', async () => {
    signedIn(sessionWith(A1, 10));
    const first = deferred<string>();
    const call = jest.fn<Promise<string>, [string]>().mockReturnValueOnce(first.promise);
    const running = withAccessToken(call);

    signedIn(accountB());
    first.reject(unauthorized());

    await expect(running).rejects.toBeInstanceOf(UnauthorizedError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('запрос A успешен, но за это время вошёл B — результат не применяется (UnauthorizedError)', async () => {
    signedIn(sessionWith(A1, 10));
    const first = deferred<string>();
    const running = withAccessToken(() => first.promise);

    signedIn(accountB());
    first.resolve('done');

    await expect(running).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('за время обновления access вошёл B — запрос не уходит от имени B', async () => {
    signedIn(sessionWith(A1, 0.5));
    const b = accountB();
    const rotation = deferred<Session>();
    refresh.mockReturnValueOnce(rotation.promise);
    const call = jest.fn(async (token: string) => token);
    const running = withAccessToken(call);

    await Promise.resolve();
    signedIn(b);
    rotation.resolve(sessionWith(A2, 15));

    await expect(running).rejects.toBeInstanceOf(UnauthorizedError);
    expect(call).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session?.accessToken).toBe(b.accessToken);
  });
});
