/// <reference types="jest" />
import { liveSession, liveSessionB } from '@/__tests__/auth-fixtures';
import type { useSessionStore as SessionStore } from '@/features/auth/session-store';

import type * as PushWeb from './push.web';
import { api } from '@/lib/api';

// одни и те же функции во всех «загрузках страницы» (`jest.isolateModules`)
const mockApi = {
  getWebPushConfig: jest.fn(),
  registerWebPushSubscription: jest.fn(),
  revokeWebPushSubscription: jest.fn(),
};
jest.mock('@/lib/api', () => ({
  get api() {
    return mockApi;
  },
}));
// access текущей сессии (без refresh): sid подписки — из него
const mockAccess = { token: '' };
jest.mock('@/features/auth/authorized', () => ({
  withAccessToken: <T>(call: (token: string) => Promise<T>) => call(mockAccess.token),
}));

const config = jest.mocked(api.getWebPushConfig);
const register = jest.mocked(api.registerWebPushSubscription);
const revoke = jest.mocked(api.revokeWebPushSubscription);

/** Публичный ключ VAPID (65 байт, `0x04…`) и тот же в байтах — как его отдаёт `subscription.options`. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : index));
const PUBLIC_KEY = Buffer.from(KEY_BYTES).toString('base64url');
const OTHER_KEY = Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : 200 - index));
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-a';
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };

interface FakeSubscription {
  endpoint: string;
  expirationTime: number | null;
  options: { applicationServerKey: ArrayBuffer };
  toJSON: () => { endpoint: string; keys: typeof KEYS };
  unsubscribe: jest.Mock;
}

const subscriptionOf = (
  endpoint = ENDPOINT,
  key: Uint8Array = KEY_BYTES,
  expirationTime: number | null = null,
): FakeSubscription => ({
  endpoint,
  expirationTime,
  options: { applicationServerKey: key.slice().buffer },
  toJSON: () => ({ endpoint, keys: KEYS }),
  unsubscribe: jest.fn(async () => {
    browser.current = null;
    return true;
  }),
});

/** Браузер с Service Worker, Push API и Notification; `current` — подписка `pushManager`. */
const browser = {
  current: null as FakeSubscription | null,
  permission: 'default' as NotificationPermission,
  listeners: new Set<(event: MessageEvent) => void>(),
  subscribe: jest.fn(),
};

function installBrowser({ userAgent = 'Chrome', standalone = false } = {}) {
  const pushManager = {
    getSubscription: async () => browser.current,
    subscribe: browser.subscribe,
  };
  Object.defineProperty(window, 'PushManager', {
    value: function PushManager() {},
    configurable: true,
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      get permission() {
        return browser.permission;
      },
      requestPermission: jest.fn(async () => {
        browser.permission = 'granted';
        return browser.permission;
      }),
    },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager }),
      addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
        browser.listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
        browser.listeners.delete(listener),
    },
  });
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
}

function removeBrowserPush() {
  delete (window as { PushManager?: unknown }).PushManager;
}

/** Сессия стора текущей «загрузки страницы» (`load`). */
let store!: typeof SessionStore;

/** Модуль заново, как загрузка страницы: кеш ключа сервера и принятой подписки; вошёл — `liveSession`. */
const load = () => {
  let module!: typeof PushWeb;
  jest.isolateModules(() => {
    // свежий реестр модулей — только require (import поднимается к началу файла)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = (require('@/features/auth/session-store') as { useSessionStore: typeof SessionStore })
      .useSessionStore;
    store.setState({ status: 'signedIn', session: { ...liveSession } });
    mockAccess.token = liveSession.accessToken;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('./push') as typeof PushWeb;
  });
  return module;
};

beforeEach(() => {
  browser.current = null;
  browser.permission = 'default';
  browser.listeners.clear();
  browser.subscribe.mockImplementation(async () => {
    browser.current = subscriptionOf();
    return browser.current;
  });
  config.mockResolvedValue({ publicKey: PUBLIC_KEY });
  register.mockResolvedValue(undefined);
  revoke.mockResolvedValue(undefined);
  installBrowser();
});
afterEach(() => jest.clearAllMocks());

describe('поддержка Web Push (ADR-0022)', () => {
  it('нет Push API в браузере — unavailable, сервер не спрашивается, подписки нет', async () => {
    removeBrowserPush();
    const push = load();
    expect(await push.getPushPermission()).toEqual({ status: 'unavailable', canAskAgain: false });
    expect(await push.obtainPushToken()).toBeNull();
    expect(config).not.toHaveBeenCalled();
  });

  it('сервер Web Push не шлёт (publicKey: null) — unavailable', async () => {
    config.mockResolvedValue({ publicKey: null });
    expect(await load().getPushPermission()).toEqual({ status: 'unavailable', canAskAgain: false });
  });

  it('iPhone в обычной вкладке — unavailable; установленная PWA (standalone) — есть', async () => {
    installBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect((await load().getPushPermission()).status).toBe('unavailable');
    installBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      standalone: true,
    });
    expect((await load().getPushPermission()).status).toBe('undetermined');
  });
});

describe('состояние и подписка', () => {
  it('default — можно спросить; denied — нет (включается в настройках браузера)', async () => {
    expect(await load().getPushPermission()).toEqual({ status: 'undetermined', canAskAgain: true });
    browser.permission = 'denied';
    expect(await load().getPushPermission()).toEqual({ status: 'denied', canAskAgain: false });
    expect(load().canOpenPushSettings).toBe(false);
  });

  it('запрос разрешения → granted без подписки → подписка VAPID → сервер принял → active', async () => {
    const push = load();
    expect(await push.requestPushPermission()).toEqual({
      status: 'granted',
      canAskAgain: false,
      subscription: 'missing',
    });
    const device = await push.obtainPushToken();
    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: KEY_BYTES,
    });
    expect(device).toEqual({ token: ENDPOINT, platform: 'web', keys: KEYS });
    await push.sendPushRegistration(liveSession.accessToken, device!);
    expect(register).toHaveBeenCalledWith(liveSession.accessToken, {
      endpoint: ENDPOINT,
      keys: KEYS,
    });
    expect((await push.getPushPermission()).subscription).toBe('active');
    // та же подписка под той же сессией — без второго запроса
    await push.sendPushRegistration(liveSession.accessToken, device!);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('другой вход (другая сессия) — подписка снова регистрируется на сервере', async () => {
    browser.permission = 'granted';
    const push = load();
    const device = (await push.obtainPushToken())!;
    await push.sendPushRegistration(liveSession.accessToken, device);
    store.setState({ session: { ...liveSessionB } });
    mockAccess.token = liveSessionB.accessToken;
    expect((await push.getPushPermission()).subscription).toBe('missing');
    await push.sendPushRegistration(liveSessionB.accessToken, device);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('подписка под старым ключом VAPID или истёкшая — expired; новая подписка заменяет её', async () => {
    browser.permission = 'granted';
    const old = subscriptionOf(ENDPOINT, OTHER_KEY);
    browser.current = old;
    const push = load();
    expect((await push.getPushPermission()).subscription).toBe('expired');
    await push.obtainPushToken();
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledTimes(1);

    browser.current = subscriptionOf(ENDPOINT, KEY_BYTES, Date.now() - 1000);
    expect((await load().getPushPermission()).subscription).toBe('expired');
  });

  it('выход: endpoint для снятия на сервере, затем отписка в браузере', async () => {
    browser.permission = 'granted';
    const push = load();
    const device = (await push.obtainPushToken())!;
    await push.sendPushRegistration(liveSession.accessToken, device);
    expect(await push.storedPushToken()).toBe(ENDPOINT);
    await push.sendPushRevoke(liveSession.accessToken, ENDPOINT);
    expect(revoke).toHaveBeenCalledWith(liveSession.accessToken, { endpoint: ENDPOINT });
    const current = browser.current!;
    await push.forgetPushToken();
    expect(current.unsubscribe).toHaveBeenCalled();
    expect((await push.getPushPermission()).subscription).toBe('missing');
  });

  it('без разрешения подписки нет и системный запрос не показывается (N5)', async () => {
    const push = load();
    expect(await push.obtainPushToken()).toBeNull();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe('сообщения service worker', () => {
  it('pokatim:open — цель приложению, pokatim:push — обновить счётчик; отписка снимает слушатель', () => {
    const onOpen = jest.fn();
    const onReceive = jest.fn();
    const unsubscribe = load().subscribePushResponses({ onOpen, onReceive });
    const target = { type: 'ride', rideId: '0190a6f4-0000-7000-8000-000000000002' };
    for (const listener of browser.listeners) {
      listener({ data: { type: 'pokatim:open', target } } as MessageEvent);
      listener({ data: { type: 'pokatim:push' } } as MessageEvent);
      listener({ data: 'чужое' } as MessageEvent);
    }
    expect(onOpen).toHaveBeenCalledWith(target);
    expect(onReceive).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(browser.listeners.size).toBe(0);
  });
});
