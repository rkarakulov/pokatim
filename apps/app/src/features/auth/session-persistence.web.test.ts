/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { CookieSession } from '@pokatim/contracts';

import { api } from '@/lib/api';

import { fetchRegistrationPoll, requestSignIn } from './queries';
import { refreshAccess } from './session-persistence';
import { resetSessionStore, useSessionStore } from './session-store';

jest.mock('@/lib/api', () => ({
  api: {
    refreshSession: jest.fn(),
    signOut: jest.fn(),
    pollRegistration: jest.fn(),
    signIn: jest.fn(),
  },
}));

const refresh = jest.mocked(api.refreshSession);
const signOut = jest.mocked(api.signOut);
const pollRegistration = jest.mocked(api.pollRegistration);
const signIn = jest.mocked(api.signIn);
const NOW = new Date('2026-10-22T10:00:00Z').getTime();

const cookieSession: CookieSession = {
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-10-22T10:15:00.000Z',
  refreshTokenExpiresAt: '2026-11-21T10:00:00.000Z',
};

type Locks = { request: jest.Mock };
const setLocks = (locks: Locks | undefined) =>
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });

/** LockManager как в браузере: задачи одного имени — строго по очереди. */
function queueLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  const request = jest.fn((name: string, task: () => Promise<unknown>) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task);
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  });
  return { request };
}

/** Промис, который тест завершает сам: «ответ сервера пришёл позже». */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const rateLimited = (retryAfterSec: number) =>
  new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec } });
const offline = () => new ApiNetworkError(new TypeError('Failed to fetch'));
const REGISTRATION_TOKEN = 'r'.repeat(43);

beforeEach(() => {
  resetSessionStore();
  sessionStorage.clear();
  localStorage.clear();
  setLocks(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

describe('сессия web: refresh в httpOnly cookie, access в памяти', () => {
  it('запуск: refresh по cookie (без тела) → вошёл; в хранилища браузера ничего не пишется', async () => {
    refresh.mockResolvedValue(cookieSession);
    await useSessionStore.getState().hydrate(NOW);

    expect(refresh).toHaveBeenCalledWith();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('ответ с refreshToken (чужой транспорт) — в памяти его нет', async () => {
    refresh.mockResolvedValue({ ...cookieSession, refreshToken: 'r'.repeat(43) });
    await useSessionStore.getState().hydrate(NOW);

    expect(useSessionStore.getState().session).toEqual(cookieSession);
  });

  it('401 (нет cookie, отозвана, истекла) → не вошёл, без повторов', async () => {
    refresh.mockRejectedValue(unauthorized());
    await useSessionStore.getState().hydrate(NOW);

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('429 — не выход: повтор через retryAfterSec, затем вошёл', async () => {
    jest.useFakeTimers();
    refresh.mockRejectedValueOnce(rateLimited(5)).mockResolvedValueOnce(cookieSession);
    const hydrating = useSessionStore.getState().hydrate(NOW);

    await jest.advanceTimersByTimeAsync(4_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).toBe('unknown');

    await jest.advanceTimersByTimeAsync(1);
    await hydrating;
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
  });

  it('429 после повторов — «сессию проверить не удалось», не signedOut; cookie не трогаем', async () => {
    jest.useFakeTimers();
    const limited = rateLimited(1);
    refresh.mockRejectedValue(limited);
    const hydrating = useSessionStore.getState().hydrate(NOW);
    await jest.advanceTimersByTimeAsync(10_000);
    await hydrating;

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'unavailable',
      session: null,
      restoreError: limited,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('429 с паузой длиннее разумного ожидания — сразу «не удалось», без скелетона на минуту', async () => {
    refresh.mockRejectedValue(rateLimited(60));
    await useSessionStore.getState().hydrate(NOW);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).toBe('unavailable');
  });

  it('нет сети — не выход: повторы, затем «не удалось» (ошибка сети — для «Нет соединения»)', async () => {
    jest.useFakeTimers();
    const error = offline();
    refresh.mockRejectedValue(error);
    const hydrating = useSessionStore.getState().hydrate(NOW);
    await jest.advanceTimersByTimeAsync(10_000);
    await hydrating;

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'unavailable',
      restoreError: error,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('повтор из «не удалось»: снова «неизвестно», затем вошёл', async () => {
    refresh.mockRejectedValueOnce(rateLimited(60)).mockResolvedValueOnce(cookieSession);
    await useSessionStore.getState().hydrate(NOW);
    expect(useSessionStore.getState().status).toBe('unavailable');

    const retrying = useSessionStore.getState().hydrate(NOW);
    expect(useSessionStore.getState().status).toBe('unknown');
    await retrying;

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
      restoreError: null,
    });
  });

  it('Web Lock: refresh, обмен регистрации (poll) и выход — под одним замком', async () => {
    const request = jest.fn((_name: string, task: () => Promise<unknown>) => task());
    setLocks({ request });
    refresh.mockResolvedValue(cookieSession);
    pollRegistration.mockResolvedValue({ state: 'pending' });

    await useSessionStore.getState().hydrate(NOW);
    await fetchRegistrationPoll(REGISTRATION_TOKEN);
    await useSessionStore.getState().signOut();

    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'pokatim.session-refresh',
      'pokatim.session-refresh',
      'pokatim.session-refresh',
    ]);
    expect(pollRegistration).toHaveBeenCalledWith({ registrationToken: REGISTRATION_TOKEN });
  });

  it('Web Lock: poll ждёт refresh — запоздалый 401 восстановления не приходит после выдачи cookie', async () => {
    setLocks(queueLocks());
    const refreshing = deferred<never>();
    refresh.mockReturnValue(refreshing.promise);
    pollRegistration.mockResolvedValue({ state: 'verified', session: cookieSession });

    const hydrating = useSessionStore.getState().hydrate(NOW);
    const polling = fetchRegistrationPoll(REGISTRATION_TOKEN);
    await Promise.resolve();
    expect(pollRegistration).not.toHaveBeenCalled();

    refreshing.reject(unauthorized());
    await hydrating;
    const poll = await polling;
    expect(pollRegistration).toHaveBeenCalledTimes(1);
    if (poll.state === 'verified') await useSessionStore.getState().signIn(poll.session);

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('без Web Lock: 401 восстановления пришёл после успешного poll — вход остаётся, выхода нет', async () => {
    const refreshing = deferred<never>();
    refresh.mockReturnValue(refreshing.promise);
    pollRegistration.mockResolvedValue({ state: 'verified', session: cookieSession });

    const hydrating = useSessionStore.getState().hydrate(NOW);
    const poll = await fetchRegistrationPoll(REGISTRATION_TOKEN);
    if (poll.state === 'verified') await useSessionStore.getState().signIn(poll.session);
    refreshing.reject(unauthorized());
    await hydrating;

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('вход во время запуска не затирается ответом refresh', async () => {
    let fail: (error: unknown) => void = () => undefined;
    refresh.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const hydrating = useSessionStore.getState().hydrate(NOW);

    await useSessionStore.getState().signIn(cookieSession);
    fail(unauthorized());
    await hydrating;

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
  });

  it('вход (сессия из ответа poll) — только память', async () => {
    await useSessionStore.getState().signIn(cookieSession);

    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('выход — sign-out по cookie; сбой сети не мешает выйти локально', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await useSessionStore.getState().signIn(cookieSession);
    signOut.mockRejectedValue(offline());
    await useSessionStore.getState().signOut();

    expect(signOut).toHaveBeenCalledWith();
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', session: null });
    warn.mockRestore();
  });

  it('вход по паролю — под тем же Web Lock (ответ меняет cookie); в памяти — CookieSession без refresh', async () => {
    const locks = queueLocks();
    setLocks(locks);
    const refreshing = deferred<CookieSession>();
    refresh.mockReturnValue(refreshing.promise);
    signIn.mockResolvedValue({
      state: 'signedIn',
      session: { ...cookieSession, refreshToken: 'r'.repeat(43) },
    });

    const hydrating = useSessionStore.getState().hydrate(NOW);
    const signingIn = requestSignIn({ email: 'rider@example.com', password: 'velo-secret' });
    await Promise.resolve();
    // вход ждёт идущий refresh: ответы не переписывают cookie друг другу
    expect(signIn).not.toHaveBeenCalled();

    refreshing.reject(unauthorized());
    await hydrating;
    const result = await signingIn;
    expect(locks.request.mock.calls.map(([name]) => name)).toEqual([
      'pokatim.session-refresh',
      'pokatim.session-refresh',
    ]);
    if (result.state !== 'signedIn') throw new Error('expected signedIn');
    await useSessionStore.getState().signIn(result.session);
    expect(useSessionStore.getState().session).toEqual(cookieSession);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('фоновая проверка после восстановления на web — без второй ротации (восстановление уже было refresh)', async () => {
    refresh.mockResolvedValue(cookieSession);

    await useSessionStore.getState().hydrate(NOW);
    await useSessionStore.getState().revalidate(NOW);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
  });

  describe('выход при сбое API (сеть, 5xx): cookie жива — перезагрузка не возвращает в аккаунт', () => {
    async function signOutFailing(error: unknown) {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await useSessionStore.getState().signIn(cookieSession);
      signOut.mockRejectedValueOnce(error);
      await useSessionStore.getState().signOut();
      warn.mockRestore();
    }

    it.each([
      ['нет сети', offline()],
      ['5xx', new ApiHttpError(503, null)],
    ])(
      '%s: после перезагрузки — не вошёл, refresh не зовётся, отзыв повторяется',
      async (_case, error) => {
        await signOutFailing(error);
        expect(useSessionStore.getState().status).toBe('signedOut');

        // перезагрузка страницы: память пуста, cookie (по мнению браузера) жива
        resetSessionStore();
        refresh.mockResolvedValue(cookieSession);
        signOut.mockResolvedValue(undefined);
        await useSessionStore.getState().hydrate(NOW);

        expect(useSessionStore.getState().status).toBe('signedOut');
        expect(refresh).not.toHaveBeenCalled();
        expect(signOut).toHaveBeenCalledTimes(2);

        // отзыв подтверждён — cookie мертва: дальше гость без refresh (B21), отзыв не повторяется
        resetSessionStore();
        await useSessionStore.getState().hydrate(NOW);
        expect(useSessionStore.getState().status).toBe('signedOut');
        expect(refresh).not.toHaveBeenCalled();
        expect(signOut).toHaveBeenCalledTimes(2);
      },
    );

    it('сервер всё ещё недоступен при перезагрузке — по-прежнему не вошёл, признак выхода остаётся', async () => {
      await signOutFailing(offline());

      resetSessionStore();
      signOut.mockRejectedValue(offline());
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await useSessionStore.getState().hydrate(NOW);
      resetSessionStore();
      await useSessionStore.getState().hydrate(NOW);
      warn.mockRestore();

      expect(useSessionStore.getState().status).toBe('signedOut');
      expect(refresh).not.toHaveBeenCalled();
      expect(signOut).toHaveBeenCalledTimes(3);
    });

    it('явный вход снимает признак: следующая перезагрузка восстанавливает сессию', async () => {
      await signOutFailing(offline());
      signIn.mockResolvedValue({ state: 'signedIn', session: cookieSession });
      await requestSignIn({ email: 'rider@example.com', password: 'velo-secret' });

      resetSessionStore();
      refresh.mockResolvedValue(cookieSession);
      await useSessionStore.getState().hydrate(NOW);

      expect(useSessionStore.getState()).toMatchObject({
        status: 'signedIn',
        session: cookieSession,
      });
      expect(localStorage.length).toBe(0);
    });

    it('выход, вставший в очередь за входом, побеждает: вход не стирает его признак, сбой выхода — без восстановления', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      setLocks(queueLocks());
      const answer = deferred<Awaited<ReturnType<typeof api.signIn>>>();
      signIn.mockReturnValue(answer.promise);
      signOut.mockRejectedValue(offline());

      // вход держит замок (ждёт ответа API); выход нажат в другой вкладке и ждёт замка
      const signingIn = requestSignIn({ email: 'rider@example.com', password: 'velo-secret' });
      const signingOut = useSessionStore.getState().signOut();
      await Promise.resolve();
      answer.resolve({ state: 'signedIn', session: cookieSession });
      await signingIn;
      await signingOut;
      warn.mockRestore();

      // перезагрузка: cookie входа жива, но выход был последним — аккаунт не восстанавливается
      resetSessionStore();
      refresh.mockResolvedValue(cookieSession);
      signOut.mockResolvedValue(undefined);
      await useSessionStore.getState().hydrate(NOW);
      expect(useSessionStore.getState().status).toBe('signedOut');
      expect(refresh).not.toHaveBeenCalled();
    });

    it('вкладка A стартует с признаком выхода, вкладка B тем временем входит — A не отзывает свежую сессию B', async () => {
      await signOutFailing(offline());
      setLocks(queueLocks());
      const answer = deferred<Awaited<ReturnType<typeof api.signIn>>>();
      signIn.mockReturnValue(answer.promise);
      refresh.mockResolvedValue(cookieSession);
      signOut.mockClear();

      // B входит и держит замок; A (перезагрузка) ждёт замка с признаком на момент старта
      const signingIn = requestSignIn({ email: 'rider@example.com', password: 'velo-secret' });
      resetSessionStore();
      const restoring = useSessionStore.getState().hydrate(NOW);
      await Promise.resolve();
      answer.resolve({ state: 'signedIn', session: cookieSession });
      await signingIn;
      await restoring;

      expect(signOut).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(useSessionStore.getState().status).toBe('signedIn');
    });

    it('хранилище браузера недоступно — выход и запуск не падают', async () => {
      const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      await signOutFailing(offline());
      resetSessionStore();
      refresh.mockRejectedValue(unauthorized());
      await useSessionStore.getState().hydrate(NOW);

      expect(useSessionStore.getState().status).toBe('signedOut');
      setItem.mockRestore();
      getItem.mockRestore();
    });
  });
});

describe('гость без лишнего refresh: признак «сессии нет» (B21 смоука dev)', () => {
  it('401 восстановления — признак; следующие запуски не зовут refresh', async () => {
    refresh.mockRejectedValue(unauthorized());
    await useSessionStore.getState().hydrate(NOW);
    expect(refresh).toHaveBeenCalledTimes(1);

    resetSessionStore();
    await useSessionStore.getState().hydrate(NOW);
    resetSessionStore();
    await useSessionStore.getState().hydrate(NOW);

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('без признака (сессии до обновления, хранилище очищено) — refresh, как раньше', async () => {
    refresh.mockResolvedValue(cookieSession);
    await useSessionStore.getState().hydrate(NOW);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(localStorage.length).toBe(0);
  });

  it.each([
    [
      'вход по паролю',
      async () => {
        signIn.mockResolvedValue({ state: 'signedIn', session: cookieSession });
        await requestSignIn({ email: 'rider@example.com', password: 'velo-secret' });
      },
    ],
    [
      'обмен регистрации (poll)',
      async () => {
        pollRegistration.mockResolvedValue({ state: 'verified', session: cookieSession });
        await fetchRegistrationPoll(REGISTRATION_TOKEN);
      },
    ],
  ])('%s снимает признак: перезагрузка восстанавливает сессию', async (_case, enter) => {
    refresh.mockRejectedValueOnce(unauthorized());
    await useSessionStore.getState().hydrate(NOW);

    await enter();
    expect(localStorage.length).toBe(0);

    resetSessionStore();
    refresh.mockResolvedValue(cookieSession);
    await useSessionStore.getState().hydrate(NOW);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      session: cookieSession,
    });
  });

  it('выход подтверждён — следующий запуск без refresh', async () => {
    await useSessionStore.getState().signIn(cookieSession);
    signOut.mockResolvedValue(undefined);
    await useSessionStore.getState().signOut();

    resetSessionStore();
    await useSessionStore.getState().hydrate(NOW);
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('401 обновления access (сессию отозвали) — признак; перезагрузка без refresh', async () => {
    refresh.mockResolvedValueOnce(cookieSession);
    await useSessionStore.getState().hydrate(NOW);
    refresh.mockRejectedValue(unauthorized());
    await expect(refreshAccess(NOW)).resolves.toEqual({ status: 'signedOut' });

    resetSessionStore();
    await useSessionStore.getState().hydrate(NOW);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('незавершённый выход при признаке — отзыв всё равно повторяется', async () => {
    refresh.mockRejectedValueOnce(unauthorized());
    await useSessionStore.getState().hydrate(NOW);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await useSessionStore.getState().signIn(cookieSession);
    signOut.mockRejectedValueOnce(offline());
    await useSessionStore.getState().signOut();
    warn.mockRestore();

    resetSessionStore();
    signOut.mockResolvedValue(undefined);
    await useSessionStore.getState().hydrate(NOW);
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().status).toBe('signedOut');
  });
});
