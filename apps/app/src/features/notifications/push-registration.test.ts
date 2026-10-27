/// <reference types="jest" />
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { liveSession, signInForTest } from '@/__tests__/auth-fixtures';
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
  useSessionStore.setState({ session: liveSession });
  config.expoConfig.extra = { eas: { projectId: 'eas-project-id' } };
  getPermissions.mockResolvedValue(granted);
  register.mockResolvedValue(undefined);
  revoke.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('registerDevicePush (ADR-0016)', () => {
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

  it('сбой сервера не бросает и токен не запоминается', async () => {
    register.mockRejectedValue(new Error('network'));
    await expect(registerDevicePush()).resolves.toBeUndefined();
    expect(await storedPushToken()).toBeNull();
  });
});

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
