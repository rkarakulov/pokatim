/// <reference types="jest" />
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { liveSession, liveSessionB, signInForTest } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { storedPushToken } from './push';
import { registerDevicePush, REVOKE_TIMEOUT_MS, revokeDevicePushToken } from './push-registration';

jest.mock('@/lib/api', () => ({
  api: { registerPushToken: jest.fn(), revokePushToken: jest.fn() },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

const register = jest.mocked(api.registerPushToken);
const revoke = jest.mocked(api.revokePushToken);
const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const getToken = jest.mocked(Notifications.getExpoPushTokenAsync);
const config = Constants as unknown as { expoConfig: { extra: Record<string, unknown> } };

const TOKEN = 'ExpoPushToken[test-device-token]';
const granted = { status: 'granted', canAskAgain: true } as Awaited<
  ReturnType<typeof Notifications.getPermissionsAsync>
>;

beforeEach(() => {
  signInForTest();
  // новый объект сессии — как новый вход: выход в прошлом тесте не закрывает регистрацию в этом
  useSessionStore.setState({ session: { ...liveSession } });
  config.expoConfig.extra = { eas: { projectId: 'eas-project-id' } };
  getPermissions.mockResolvedValue(granted);
  register.mockResolvedValue(undefined);
  revoke.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Ответ сервера, который тест отпускает сам (`release`). */
function deferred() {
  let release!: () => void;
  const promise = new Promise<undefined>((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}

describe('registerDevicePush (ADR-0017)', () => {
  it('разрешение есть и projectId задан — токен уходит на сервер и запоминается', async () => {
    await registerDevicePush();

    expect(getToken).toHaveBeenCalledWith({ projectId: 'eas-project-id' });
    expect(register).toHaveBeenCalledWith(liveSession.accessToken, {
      token: TOKEN,
      platform: 'ios',
    });
    expect(await storedPushToken()).toBe(TOKEN);
  });

  it('нет projectId EAS — регистрации нет (RC-11)', async () => {
    config.expoConfig.extra = {};
    await registerDevicePush();

    expect(getToken).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(await storedPushToken()).toBeNull();
  });

  it('разрешения нет — системный запрос не показывается, регистрации нет (N5)', async () => {
    getPermissions.mockResolvedValue({ ...granted, status: 'undetermined' } as typeof granted);
    await registerDevicePush();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('токен запоминается до запроса: сбой сервера не бросает, выход всё равно снимет токен', async () => {
    register.mockRejectedValue(new Error('network'));
    await expect(registerDevicePush()).resolves.toBeUndefined();
    expect(await storedPushToken()).toBe(TOKEN);
  });

  it('Android: канал `default` создаётся до проверки разрешения и токена', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await registerDevicePush();

    const channel = jest.mocked(Notifications.setNotificationChannelAsync);
    expect(channel).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'default' }));
    expect(channel.mock.invocationCallOrder[0]).toBeLessThan(
      getPermissions.mock.invocationCallOrder[0]!,
    );
    expect(register).toHaveBeenCalledWith(liveSession.accessToken, {
      token: TOKEN,
      platform: 'android',
    });
  });
});

describe('регистрация и выход одновременно (ADR-0017)', () => {
  it('выход во время запроса регистрации ждёт её и снимает тот же токен', async () => {
    const server = deferred();
    register.mockReturnValue(server.promise);

    const registering = registerDevicePush();
    await waitForCall(register);
    const revoking = revokeDevicePushToken();
    // запрос регистрации ещё в полёте — снятия пока нет
    await Promise.resolve();
    expect(revoke).not.toHaveBeenCalled();

    server.release();
    await Promise.all([registering, revoking]);
    expect(revoke).toHaveBeenCalledWith(liveSession.accessToken, { token: TOKEN });
    expect(revoke.mock.invocationCallOrder[0]).toBeGreaterThan(
      register.mock.invocationCallOrder[0]!,
    );
    expect(await storedPushToken()).toBeNull();
  });

  it('регистрация, ещё не дошедшая до сервера, при начавшемся выходе не стартует', async () => {
    const token = deferred();
    getToken.mockReturnValueOnce(
      token.promise.then(() => ({ type: 'expo', data: TOKEN })) as ReturnType<typeof getToken>,
    );

    const registering = registerDevicePush();
    await waitForCall(getToken);
    const revoking = revokeDevicePushToken();
    token.release();
    await Promise.all([registering, revoking]);

    expect(register).not.toHaveBeenCalled();
    expect(await storedPushToken()).toBeNull();
  });

  it('после начала выхода новые регистрации не стартуют; после нового входа — снова', async () => {
    await revokeDevicePushToken();
    await registerDevicePush();
    expect(getToken).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    useSessionStore.setState({ session: { ...liveSession } });
    await registerDevicePush();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('регистрация зависла — выход ждёт не дольше таймаута и стирает токен', async () => {
    const server = deferred();
    register.mockReturnValue(server.promise);
    const registering = registerDevicePush();
    await waitForCall(register);
    jest.useFakeTimers();

    const revoking = revokeDevicePushToken();
    await jest.advanceTimersByTimeAsync(REVOKE_TIMEOUT_MS);
    await expect(revoking).resolves.toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
    expect(await storedPushToken()).toBeNull();
    // ответ пришёл после выхода: токен не возвращается в хранилище
    server.release();
    await registering;
    expect(await storedPushToken()).toBeNull();
  });

  it('выход A истёк по таймауту, вошёл B — поздний ответ регистрации A не читает и не снимает токен B', async () => {
    const TOKEN_B = 'ExpoPushToken[device-token-b]';
    const server = deferred();
    register.mockReturnValueOnce(server.promise);
    const registering = registerDevicePush();
    await waitForCall(register);
    jest.useFakeTimers();
    const revoking = revokeDevicePushToken();
    await jest.advanceTimersByTimeAsync(REVOKE_TIMEOUT_MS);
    await revoking;
    jest.useRealTimers();

    // вход B на том же устройстве: своя сессия и свой токен
    useSessionStore.setState({ session: { ...liveSessionB } });
    getToken.mockResolvedValueOnce({ type: 'expo', data: TOKEN_B });
    await registerDevicePush();
    expect(register).toHaveBeenLastCalledWith(liveSessionB.accessToken, {
      token: TOKEN_B,
      platform: 'ios',
    });

    server.release();
    await registering;
    await settle();
    expect(revoke).not.toHaveBeenCalled();
    expect(await storedPushToken()).toBe(TOKEN_B);
  });
});

/** Отпустить цепочки промисов, которые тест не может дождаться напрямую (оставшаяся операция выхода). */
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Дождаться вызова мока (асинхронные шаги до него — SecureStore, разрешение). */
async function waitForCall(fn: jest.Mock | ((...args: never[]) => unknown)) {
  for (let i = 0; i < 50 && jest.mocked(fn).mock.calls.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(fn).toHaveBeenCalled();
}

describe('revokeDevicePushToken — выход снимает токен устройства', () => {
  it('токен был зарегистрирован — сервер снимает его, устройство забывает', async () => {
    await registerDevicePush();
    await revokeDevicePushToken();

    expect(revoke).toHaveBeenCalledWith(liveSession.accessToken, { token: TOKEN });
    expect(await storedPushToken()).toBeNull();
  });

  it('токена нет — запроса нет', async () => {
    await revokeDevicePushToken();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('ошибка сервера не блокирует выход', async () => {
    await registerDevicePush();
    revoke.mockRejectedValue(new Error('offline'));

    await expect(revokeDevicePushToken()).resolves.toBeUndefined();
    expect(await storedPushToken()).toBeNull();
  });

  it('сервер не отвечает — выход ждёт не дольше таймаута', async () => {
    await registerDevicePush();
    revoke.mockReturnValue(new Promise(() => undefined));
    jest.useFakeTimers();

    const revoking = revokeDevicePushToken();
    await jest.advanceTimersByTimeAsync(REVOKE_TIMEOUT_MS);
    await expect(revoking).resolves.toBeUndefined();
    expect(await storedPushToken()).toBeNull();
  });
});
