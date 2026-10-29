/// <reference types="jest" />
import {
  cacheVersion,
  type PrecacheFile,
  precacheList,
  serviceWorkerSource,
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

const RACE = '0190a6f4-0000-7000-8000-000000000001';

describe('service worker: Web Push (ADR-0021)', () => {
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
    expect(sw.opened).toEqual([`/races/${RACE}`, '/notifications', '/notifications']);
  });
});
