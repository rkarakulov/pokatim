/// <reference types="jest" />
import { liveSession } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { connectDevice, isConnectInFlight, takeConnectOrigin } from './connect-flow';
import { leavePageTo } from './leave-page.web';

jest.mock('@/lib/api', () => ({ api: { connectDevice: jest.fn() } }));
// переход страницы jsdom не выполняет — уход к агрегатору проверяем по вызову
jest.mock('./leave-page.web', () => ({ leavePageTo: jest.fn() }));

const AUTHORIZE_URL = 'https://ow.example/authorize?state=x';
const assign = jest.mocked(leavePageTo);

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession, sessionReceivedAt: null });
  jest.mocked(api.connectDevice).mockResolvedValue({ authorizeUrl: AUTHORIZE_URL });
  window.sessionStorage.clear();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('подключение устройства (web)', () => {
  it('ссылка возврата — `<origin>/devices/return`; откуда пришли — в sessionStorage; переход к агрегатору', async () => {
    const result = await connectDevice('wahoo', 'onboarding');

    expect(result).toEqual({ kind: 'redirected' });
    expect(api.connectDevice).toHaveBeenCalledWith(liveSession.accessToken, 'wahoo', {
      returnUrl: `${window.location.origin}/devices/return`,
    });
    expect(assign).toHaveBeenCalledWith(AUTHORIZE_URL);
    expect(isConnectInFlight()).toBe(false);
  });

  it('origin читается один раз и удаляется; мусор и отсутствие — `undefined`', async () => {
    await connectDevice('garmin', 'settings');

    expect(takeConnectOrigin()).toBe('settings');
    expect(takeConnectOrigin()).toBeUndefined();

    window.sessionStorage.setItem('pokatim.devicesConnectOrigin', 'https://evil.example');
    expect(takeConnectOrigin()).toBeUndefined();
  });

  it('отказ сервера — без перехода и без записи origin', async () => {
    jest.mocked(api.connectDevice).mockRejectedValue(new Error('409'));

    await expect(connectDevice('garmin', 'settings')).rejects.toThrow('409');
    expect(assign).not.toHaveBeenCalled();
    expect(takeConnectOrigin()).toBeUndefined();
  });
});
