/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CookieSession } from '@pokatim/contracts';

import { fakeAccessToken, SID_B, USER_B } from '@/__tests__/jwt';
import { requestSignIn } from '@/features/auth/queries';
import { resetSessionStore, useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { requestAccountDeletion } from './queries';

jest.mock('@/lib/api', () => ({
  api: {
    deleteAccount: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  },
}));

const deleteAccount = jest.mocked(api.deleteAccount);
const signIn = jest.mocked(api.signIn);
const refresh = jest.mocked(api.refreshSession);
const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const inMinutes = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const tagOf = (token: string) => token.split('.')[2];

const cookieSession = (tag: string, accessMinutes: number, claims = {}): CookieSession => {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: fakeAccessToken({ iat: now, exp: now + accessMinutes * 60, ...claims }, tag),
    accessTokenExpiresAt: inMinutes(accessMinutes),
    refreshTokenExpiresAt: inMinutes(30 * 24 * 60),
  };
};

/** LockManager как в браузере: задачи одного имени — строго по очереди (вкладки одного браузера делят его). */
function queueLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: jest.fn((name: string, task: () => Promise<unknown>) => {
      const run = (tails.get(name) ?? Promise.resolve()).then(task);
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    }),
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetSessionStore();
  localStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'locks', { value: queueLocks(), configurable: true });
  useSessionStore.setState({ status: 'signedIn', session: cookieSession('a1', 10) });
});

describe('удаление аккаунта (web): под замком сессии', () => {
  it('вход другой вкладки ждёт ответа удаления: ответ не стирает новую cookie, отзыва (sign-out) нет', async () => {
    const deletion = deferred<undefined>();
    deleteAccount.mockReturnValue(deletion.promise);
    const sessionB = cookieSession('b1', 15, { sub: USER_B, sid: SID_B });
    signIn.mockResolvedValue({ state: 'signedIn', session: sessionB });

    const deleting = requestAccountDeletion({ password: 'velo-secret' });
    await tick();
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    // вкладка B входит, пока удаление ждёт ответа сервера
    const signingIn = requestSignIn({ email: 'b@example.com', password: 'b-secret' });
    await tick();
    expect(signIn).not.toHaveBeenCalled();

    deletion.resolve(undefined);
    await deleting;
    await signingIn;

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(api.signOut).not.toHaveBeenCalled();
    // признак «сессии нет» от удаления снят входом B, вставшим в очередь позже
    expect(localStorage.getItem('pokatim.noSession')).toBeNull();
    expect(localStorage.getItem('pokatim.signOutPending')).toBeNull();
  });

  it('успех: устройство помнит «сессии нет», признак незавершённого выхода снят, без запроса sign-out', async () => {
    localStorage.setItem('pokatim.signOutPending', '1');
    deleteAccount.mockResolvedValue(undefined);

    await requestAccountDeletion({ password: 'velo-secret' });

    expect(localStorage.getItem('pokatim.noSession')).toBe('1');
    expect(localStorage.getItem('pokatim.signOutPending')).toBeNull();
    expect(api.signOut).not.toHaveBeenCalled();
  });

  it('401 → refresh под замком (вне запроса удаления — без вложенного захвата) → повтор', async () => {
    refresh.mockResolvedValueOnce(cookieSession('a2', 15));
    deleteAccount.mockImplementation(async (token) => {
      if (tagOf(token) === 'a1') throw unauthorized();
      return undefined;
    });

    await requestAccountDeletion({ password: 'velo-secret' });

    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('pokatim.noSession')).toBe('1');
  });

  it('отказ (403) — устройство ничего не забывает', async () => {
    deleteAccount.mockRejectedValue(
      new ApiHttpError(403, { code: 'PASSWORD_INCORRECT', message: 'x' }),
    );

    await expect(requestAccountDeletion({ password: 'wrong' })).rejects.toBeInstanceOf(
      ApiHttpError,
    );
    expect(localStorage.getItem('pokatim.noSession')).toBeNull();
  });
});
