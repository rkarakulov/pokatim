/// <reference types="jest" />
import {
  cacheVersion,
  isTicketNavigationPath,
  type PrecacheFile,
  precacheList,
  serviceWorkerSource,
  TICKET_SHELL_KEY,
} from './service-worker.ts';
import { loadServiceWorker, SW_ORIGIN as ORIGIN } from './service-worker-harness.ts';

const ENTRY = '/_expo/static/js/web/entry-872592925b2b7e57d14b37108df0c4d9.js';
const CSS = '/_expo/static/css/web-91c229a1be935b0bc16fd6878f97066c.css';
const FONT =
  '/assets/__node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.51b6ad87261f18b6433ec52871ddfabc.ttf';
const BACK_ICON =
  '/assets/__node_modules/expo-router/assets/react-navigation/elements/back-icon.35ba0eaec5a4f5ed12ca16fabeae451d.png';
const CLEAR_ICON_2X =
  '/assets/__node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@2x.png';

const exported = [
  '/favicon.ico',
  '/icons/icon-192.png',
  '/sw.js',
  FONT,
  ENTRY,
  CSS,
  BACK_ICON,
  CLEAR_ICON_2X,
];

const withContent = (paths: readonly string[], content = 'v1'): PrecacheFile[] =>
  paths.map((path) => ({ path, content: `${path}#${content}` }));

describe('service worker: precache', () => {
  it('только хешированная статика сборки, по порядку', () => {
    expect(precacheList(exported)).toEqual([CSS, ENTRY, FONT, BACK_ICON, CLEAR_ICON_2X].sort());
  });

  it('HTML, данные loader-ов, API и manifest — не в списке', () => {
    const dynamic = [
      '/',
      '/status',
      '/_expo/loaders/status',
      '/v1/health',
      '/manifest.webmanifest',
    ];
    expect(precacheList(dynamic)).toEqual([]);
  });

  it('public/ без хеша в имени, служебные экраны expo-router и source maps — не в списке', () => {
    const excluded = [
      // public/assets/* копируется в dist/client/assets как есть: имя не меняется с содержимым
      '/assets/logo.png',
      '/assets/images/hero.jpg',
      '/_expo/static/js/web/no-hash.js',
      // картинки экранов sitemap, unmatched, error из expo-router
      '/assets/__node_modules/expo-router/assets/sitemap.412dd9275b6b48ad28f5e3d81bb1f626.png',
      '/assets/__node_modules/expo-router/assets/unmatched.20e71bdf79e3a97bf55fd9e164041578.png',
      '/assets/__node_modules/expo-router/assets/error.d1ea1496f9057eb392d5bbf3732a61b7.png',
      `${ENTRY}.map`,
    ];
    expect(precacheList(excluded)).toEqual([]);
  });

  it('версия кеша стабильна для той же сборки', () => {
    const files = withContent(precacheList(exported));
    expect(cacheVersion(files)).toBe(cacheVersion(files.map((file) => ({ ...file }))));
  });

  it('версия кеша меняется с содержимым при тех же именах (dev-сборка) и со списком', () => {
    const paths = precacheList(exported);
    const version = cacheVersion(withContent(paths));
    const changed = withContent(paths).map((file) =>
      file.path === ENTRY ? { ...file, content: 'другой бандл' } : file,
    );
    expect(cacheVersion(changed)).not.toBe(version);
    expect(cacheVersion(withContent(paths, 'v2'))).not.toBe(version);
    expect(cacheVersion(withContent([...paths, BACK_ICON.replace('back', 'menu')]))).not.toBe(
      version,
    );
  });

  it('sw.js: версия и список сборки, без путей API и содержимого файлов', () => {
    const files = withContent(precacheList(exported));
    const source = serviceWorkerSource(files);
    expect(source).toContain(`static-${cacheVersion(files)}`);
    expect(source).toContain(ENTRY);
    expect(source).not.toContain('/v1');
    expect(source).not.toContain('/_expo/loaders');
    expect(source).not.toContain('#v1');
  });
});

describe('service worker: оболочка билета для офлайн-старта PWA (event-tickets AC12)', () => {
  const files = withContent(precacheList(exported));
  const source = serviceWorkerSource(files);

  it('кеш оболочки — с версией сборки (старая оболочка ссылалась бы на удалённые бандлы)', () => {
    expect(source).toContain(`tickets-shell-${cacheVersion(files)}`);
    expect(source).toContain("key.startsWith('tickets-shell-')");
  });

  it('только навигации на /tickets/<код>: network-first, в кеш — одна общая оболочка (не по коду)', () => {
    expect(isTicketNavigationPath('/tickets/ABCDE12345')).toBe(true);
    expect(isTicketNavigationPath('/tickets/abcde-12345')).toBe(true);
    for (const other of [
      '/tickets',
      '/tickets/',
      '/tickets/A/B',
      '/races/x',
      '/',
      '/v1/tickets/A',
    ]) {
      expect(isTicketNavigationPath(other)).toBe(false);
    }
    expect(source).toContain("event.request.mode === 'navigate'");
    expect(source).toContain(`${TICKET_SHELL_KEY}`);
  });
});

describe('service worker: поведение оболочки билета (исполнение sw.js)', () => {
  type Listener = (event: {
    request: { url: string; method: string; mode: string };
    respondWith: (response: Promise<unknown>) => void;
    waitUntil: (promise: Promise<unknown>) => void;
  }) => void;

  /** sw.js в песочнице: `self`, `caches`, `fetch` — фейки; возвращает обработчик fetch и хранилище кешей. */
  function load(fetchImpl: (request: unknown) => Promise<unknown>) {
    const listeners: Record<string, Listener> = {};
    const stores = new Map<string, Map<string, unknown>>();
    const caches = {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
          // запись в кеш медленнее ответа: без `waitUntil` её не дождаться
          put: (key: string, value: unknown) =>
            new Promise<void>((done) =>
              setTimeout(() => {
                store.set(key, value);
                done();
              }, 20),
            ),
          match: async (key: string) => store.get(key),
          addAll: async () => undefined,
        };
      },
      match: async () => undefined,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    };
    const self = {
      location: { origin: 'https://pokatim.test' },
      addEventListener: (type: string, listener: Listener) => (listeners[type] = listener),
      skipWaiting: () => undefined,
      clients: { claim: async () => undefined },
    };
    new Function('self', 'caches', 'fetch', serviceWorkerSource(withContent([ENTRY])))(
      self,
      caches,
      fetchImpl,
    );
    const pending: Promise<unknown>[] = [];
    const respond = async (path: string, mode = 'navigate') => {
      let result: Promise<unknown> | undefined;
      listeners.fetch!({
        request: { url: `https://pokatim.test${path}`, method: 'GET', mode },
        respondWith: (response) => (result = response),
        waitUntil: (promise) => void pending.push(promise),
      });
      return result;
    };
    /** Работа после ответа (запись в кеш) — только через `event.waitUntil`: иначе браузер может остановить worker. */
    const settled = async () => {
      await Promise.all(pending);
    };
    return { respond, stores, settled };
  }

  const html = (body: string) => ({
    ok: true,
    type: 'basic',
    redirected: false,
    body,
    clone() {
      return { ...this };
    },
  });

  it('онлайн — ответ сети, оболочка сохраняется; офлайн — оболочка для любого кода', async () => {
    let online = true;
    const { respond, stores, settled } = load(async () => {
      if (!online) throw new TypeError('offline');
      return html('shell');
    });

    await expect(respond('/tickets/ABCDE12345')).resolves.toMatchObject({ body: 'shell' });
    await settled();
    const shell = [...stores.entries()].find(([key]) => key.startsWith('tickets-shell-'))?.[1];
    expect(shell?.get(TICKET_SHELL_KEY)).toMatchObject({ body: 'shell' });

    online = false;
    await expect(respond('/tickets/FGHJK67890')).resolves.toMatchObject({ body: 'shell' });
  });

  it('офлайн без сохранённой оболочки — ошибка сети; редирект и не-200 не кешируются', async () => {
    const { respond, stores, settled } = load(async () => ({ ...html('x'), redirected: true }));
    await respond('/tickets/ABCDE12345');
    await settled();
    expect([...stores.values()].every((store) => store.size === 0)).toBe(true);

    const offline = load(async () => {
      throw new TypeError('offline');
    });
    await expect(offline.respond('/tickets/ABCDE12345')).rejects.toThrow('offline');
  });

  it('прочие навигации и запросы билета не из навигации — мимо service worker', async () => {
    const { respond } = load(async () => html('x'));
    await expect(respond('/races/x')).resolves.toBeUndefined();
    await expect(respond('/tickets/ABCDE12345', 'cors')).resolves.toBeUndefined();
  });
});

const RACE = '0190a6f4-0000-7000-8000-000000000001';

describe('service worker: Web Push (ADR-0022)', () => {
  it('push — системное уведомление с текстом и целью; открытым окнам — сигнал обновить счётчик', async () => {
    const sw = loadServiceWorker();
    sw.windows.push({ url: `${ORIGIN}/`, focused: false });
    const target = { type: 'race', raceId: RACE };
    await sw.push({ title: 'Результат засчитан', body: '«Гонка»: 3 место.', target });
    expect(sw.shown).toEqual([
      {
        title: 'Результат засчитан',
        options: expect.objectContaining({
          body: '«Гонка»: 3 место.',
          icon: '/icons/icon-192.png',
          data: { target },
        }),
      },
    ]);
    expect(sw.messages).toEqual([{ url: `${ORIGIN}/`, message: { type: 'pokatim:push' } }]);
  });

  it('битый payload — уведомление «Покатим» без цели (браузер требует показать)', async () => {
    const sw = loadServiceWorker();
    await sw.push('garbage');
    expect(sw.shown).toEqual([
      { title: 'Покатим', options: expect.objectContaining({ body: '', data: { target: null } }) },
    ]);
  });

  it('нажатие при открытом окне — фокус и цель приложению (переход роутером), новое окно не открывается', async () => {
    const sw = loadServiceWorker();
    sw.windows.push(
      { url: 'https://other.test/', focused: false },
      { url: `${ORIGIN}/races`, focused: false },
    );
    const target = { type: 'ride', rideId: RACE };
    const notification = await sw.click(target);
    expect(notification.closed).toBe(true);
    expect(sw.windows.map((item) => item.focused)).toEqual([false, true]);
    expect(sw.messages).toEqual([
      { url: `${ORIGIN}/races`, message: { type: 'pokatim:open', target } },
    ]);
    expect(sw.opened).toEqual([]);
  });

  it('нажатие без окна — новое окно по пути цели; незнакомая цель — центр уведомлений', async () => {
    const sw = loadServiceWorker();
    await sw.click({ type: 'race', raceId: RACE });
    await sw.click({ type: 'race', raceId: '../admin' });
    await sw.click(null);
    await sw.click({ type: 'profile-edit' });
    expect(sw.opened).toEqual([
      `/races/${RACE}`,
      '/notifications',
      '/notifications',
      '/settings/profile',
    ]);
  });
});
