/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { CookieSession, type Session } from '@pokatim/contracts';
import * as SecureStore from 'expo-secure-store';

import { api } from '@/lib/api';
import { NOW, session } from '@/__tests__/auth-fixtures';
import { fakeAccessToken } from '@/__tests__/jwt';

import { requestSignIn } from './queries';
import { withSessionLock } from './session-lock';
import { isSignedIn, resetSessionStore, useSessionStore } from './session-store';

jest.mock('@/lib/api', () => ({
  api: { refreshSession: jest.fn(), signOut: jest.fn(), signIn: jest.fn() },
}));

const refresh = jest.mocked(api.refreshSession);
const signOut = jest.mocked(api.signOut);
const signInApi = jest.mocked(api.signIn);

/** Сессия в памяти стора — без refresh (он только в SecureStore). */
const inMemory = (value: Session) => CookieSession.parse(value);

const stored = () =>
  jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

const rotated: Session = {
  ...session,
  // та же сессия того же аккаунта, новый access
  accessToken: fakeAccessToken({}, 'rotated'),
  refreshToken: 'refresh-2',
  refreshTokenExpiresAt: '2026-11-21T10:05:00.000Z',
};
const unauthorized = () => new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' });
const offline = () => new ApiNetworkError(new TypeError('Network request failed'));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** Фоновая проверка после гидрации завершилась: замок сессии свободен (следующая операция прошла). */
const settle = () => withSessionLock(() => Promise.resolve());

beforeEach(() => {
  resetSessionStore();
  // по умолчанию сервер недоступен: фоновая проверка оставляет сессию как есть
  refresh.mockRejectedValue(offline());
  signOut.mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('сессия', () => {
  it('до гидрации статус неизвестен; пустое хранилище → не вошёл', async () => {
    expect(useSessionStore.getState().status).toBe('unknown');
    await useSessionStore.getState().hydrate(NOW.getTime());
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('вход сохраняет сессию в SecureStore, гидрация после перезапуска её восстанавливает (в памяти — без refresh)', async () => {
    signInApi.mockResolvedValue({ state: 'signedIn', session });
    await requestSignIn({ email: 'a@b.by', password: 'x' });
    expect(useSessionStore.getState().session).toEqual(inMemory(session));
    expect(JSON.parse(stored().get('pokatim.session') ?? '')).toEqual(session);
    expect(isSignedIn(useSessionStore.getState(), NOW.getTime())).toBe(true);

    resetSessionStore();
    await useSessionStore.getState().hydrate(NOW.getTime());
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().session).toEqual(inMemory(session));
  });

  it('гард: вошедшим считается только непросроченный refresh (access 15 мин не важен)', async () => {
    await useSessionStore.getState().signIn(session);
    const afterAccess = new Date('2026-10-22T12:00:00Z').getTime();
    expect(isSignedIn(useSessionStore.getState(), afterAccess)).toBe(true);
    const afterRefresh = new Date('2026-11-21T10:00:01Z').getTime();
    expect(isSignedIn(useSessionStore.getState(), afterRefresh)).toBe(false);
  });

  it('просроченная или битая сессия при запуске удаляется', async () => {
    stored().set('pokatim.session', JSON.stringify(session));
    await useSessionStore.getState().hydrate(new Date('2026-12-01T00:00:00Z').getTime());
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(stored().has('pokatim.session')).toBe(false);

    stored().set('pokatim.session', '{"accessToken":1');
    await useSessionStore.getState().hydrate(NOW.getTime());
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(stored().has('pokatim.session')).toBe(false);
  });

  it('хранилище недоступно — запуск не блокируется, пользователь не вошёл', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('keychain locked'));
    await useSessionStore.getState().hydrate(NOW.getTime());
    expect(useSessionStore.getState().status).toBe('signedOut');
  });
});

describe('native: фоновая проверка сессии после локального восстановления (R5)', () => {
  it('200 — новый refresh в SecureStore и в сторе; ротация — по телу с сохранённым refresh', async () => {
    refresh.mockResolvedValue(rotated);
    stored().set('pokatim.session', JSON.stringify(session));

    await useSessionStore.getState().hydrate(NOW.getTime());
    // вход — сразу по локальной сессии, без ожидания сети
    expect(useSessionStore.getState().status).toBe('signedIn');
    await settle();

    expect(refresh).toHaveBeenCalledWith({ refreshToken: session.refreshToken });
    expect(JSON.parse(stored().get('pokatim.session') ?? '')).toEqual(rotated);
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().session).toEqual(inMemory(rotated));
  });

  it('401 (отозвана, reuse, выход на другом устройстве) — локальный выход, SecureStore пуст, гард ведёт на «Вход»', async () => {
    refresh.mockRejectedValue(unauthorized());
    stored().set('pokatim.session', JSON.stringify(session));

    await useSessionStore.getState().hydrate(NOW.getTime());
    await settle();

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      returning: true,
    });
    expect(stored().has('pokatim.session')).toBe(false);
  });

  it('офлайн-старт — остаёмся в аккаунте; одна немедленная повторная попытка', async () => {
    stored().set('pokatim.session', JSON.stringify(session));

    await useSessionStore.getState().hydrate(NOW.getTime());
    await settle();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().session).toEqual(inMemory(session));
    expect(JSON.parse(stored().get('pokatim.session') ?? '')).toEqual(session);
  });

  it('сеть оборвалась один раз — повтор в пределах окна проходит', async () => {
    refresh.mockRejectedValueOnce(offline()).mockResolvedValueOnce(rotated);
    stored().set('pokatim.session', JSON.stringify(session));

    await useSessionStore.getState().hydrate(NOW.getTime());
    await settle();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().session).toEqual(inMemory(rotated));
  });

  it.each([
    [
      '429',
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 30 } }),
    ],
    ['5xx', new ApiHttpError(503, null)],
  ])('%s — остаёмся в аккаунте без повторов', async (_case, error) => {
    refresh.mockRejectedValue(error);
    stored().set('pokatim.session', JSON.stringify(session));

    await useSessionStore.getState().hydrate(NOW.getTime());
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().session).toEqual(inMemory(session));
  });
});

describe('native: выход', () => {
  it('сервер отзывает сессию по refresh из SecureStore, хранилище пусто, гард ведёт на «Вход»', async () => {
    stored().set('pokatim.session', JSON.stringify(session));
    await useSessionStore.getState().signIn(session);

    await useSessionStore.getState().signOut();

    expect(signOut).toHaveBeenCalledWith({ refreshToken: session.refreshToken });
    expect(stored().has('pokatim.session')).toBe(false);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      returning: true,
    });
  });

  it('офлайн — локальный выход всё равно', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    signOut.mockRejectedValue(offline());
    stored().set('pokatim.session', JSON.stringify(session));
    await useSessionStore.getState().signIn(session);

    await useSessionStore.getState().signOut();

    expect(stored().has('pokatim.session')).toBe(false);
    expect(useSessionStore.getState().status).toBe('signedOut');
    // в предупреждении — только имя ошибки, без токенов
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^sign-out failed: \w+$/));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(session.refreshToken);
    warn.mockRestore();
  });

  it('выход во время фоновой ротации ждёт её и отзывает уже новый refresh', async () => {
    const pending = deferred<Session>();
    refresh.mockReturnValue(pending.promise);
    stored().set('pokatim.session', JSON.stringify(session));
    await useSessionStore.getState().hydrate(NOW.getTime());

    const out = useSessionStore.getState().signOut();
    // ротация ждёт ответа сервера: замок занят, выход стоит в очереди
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledWith({ refreshToken: session.refreshToken });
    expect(signOut).not.toHaveBeenCalled();

    pending.resolve(rotated);
    await out;

    expect(signOut).toHaveBeenCalledWith({ refreshToken: rotated.refreshToken });
    expect(stored().has('pokatim.session')).toBe(false);
    // запоздалый результат ротации не возвращает вошедшее состояние
    await settle();
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', session: null });
  });

  it('выход сразу после входа ждёт записи SecureStore: поздняя запись не возвращает сессию, сервер её отзывает', async () => {
    const write = deferred<void>();
    jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
      await write.promise;
      stored().set(key, value);
    });
    signInApi.mockResolvedValue({ state: 'signedIn', session });

    const signingIn = requestSignIn({ email: 'a@b.by', password: 'x' });
    const out = useSessionStore.getState().signOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // запись ещё идёт — выход стоит в очереди замка
    expect(signOut).not.toHaveBeenCalled();

    write.resolve();
    await signingIn;
    await out;

    expect(signOut).toHaveBeenCalledWith({ refreshToken: session.refreshToken });
    expect(stored().has('pokatim.session')).toBe(false);
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', session: null });
  });
});
