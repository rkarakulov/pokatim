/// <reference types="jest" />
import { fetchPublicForSsr, type PublicSsrResult } from '@/lib/public-ssr';

import { refreshSsrTheme, SSR_THEME_PATHS, ssrThemeId } from './ssr-theme';

jest.mock('@/lib/public-ssr', () => ({ fetchPublicForSsr: jest.fn() }));

type Appearance = PublicSsrResult<{ themeId: string }>;
const fetchTheme = jest.mocked(fetchPublicForSsr) as unknown as jest.Mock<Promise<Appearance>>;
const KEY = Symbol.for('pokatim.appTheme');
const holder = globalThis as Record<symbol, unknown>;

const found = (themeId: string): Appearance => ({ status: 'found', data: { themeId } });
const UNAVAILABLE: Appearance = { status: 'unavailable' };

function deferred() {
  let resolve!: (value: Appearance) => void;
  const promise = new Promise<Appearance>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z') }));
afterEach(() => {
  delete holder[KEY];
  fetchTheme.mockReset();
  jest.useRealTimers();
});

describe('тема процесса SSR', () => {
  it('ещё не узнавали — «Классика»', () => {
    expect(ssrThemeId()).toBe('classic');
  });

  it('первое обращение процесса ждёт ответ API; тема — в globalThis под Symbol.for (общая для бандлов)', async () => {
    fetchTheme.mockResolvedValue(found('atlas'));
    await refreshSsrTheme();
    expect(fetchTheme).toHaveBeenCalledWith('/v1/appearance', expect.anything(), { cache: false });
    expect(ssrThemeId()).toBe('atlas');
    expect(holder[KEY]).toMatchObject({ themeId: 'atlas' });
  });

  it('параллельные GET — одно обращение к API (single-flight)', async () => {
    const response = deferred();
    fetchTheme.mockReturnValue(response.promise);
    const pending = Promise.all([refreshSsrTheme(), refreshSsrTheme(), refreshSsrTheme()]);
    response.resolve(found('chrono'));
    await pending;
    expect(fetchTheme).toHaveBeenCalledTimes(1);
    expect(ssrThemeId()).toBe('chrono');
  });

  it('не чаще раза в 60 с при любом исходе: сбои подряд — одно обращение за окно', async () => {
    fetchTheme.mockResolvedValue(UNAVAILABLE);
    await refreshSsrTheme();
    await refreshSsrTheme();
    jest.advanceTimersByTime(59_000);
    await refreshSsrTheme();
    expect(fetchTheme).toHaveBeenCalledTimes(1);
    expect(ssrThemeId()).toBe('classic');

    jest.advanceTimersByTime(1_000);
    fetchTheme.mockRejectedValueOnce(new Error('boom'));
    await refreshSsrTheme();
    await refreshSsrTheme();
    expect(fetchTheme).toHaveBeenCalledTimes(2);
    expect(ssrThemeId()).toBe('classic');
  });

  it('после 60 с — новое обращение; известная тема обновляется в фоне, рендер не ждёт', async () => {
    fetchTheme.mockResolvedValueOnce(found('atlas'));
    await refreshSsrTheme();

    jest.advanceTimersByTime(60_000);
    const response = deferred();
    fetchTheme.mockReturnValueOnce(response.promise);
    let done = false;
    void refreshSsrTheme().then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(fetchTheme).toHaveBeenCalledTimes(2);
    expect(ssrThemeId()).toBe('atlas');

    response.resolve(found('journal'));
    await jest.runAllTimersAsync();
    expect(ssrThemeId()).toBe('journal');
  });

  it('после первого сбоя процесс больше не ждёт API: тема — последняя известная («Классика»)', async () => {
    fetchTheme.mockResolvedValueOnce(UNAVAILABLE);
    await refreshSsrTheme();
    jest.advanceTimersByTime(60_000);
    fetchTheme.mockReturnValueOnce(new Promise(() => undefined));
    let done = false;
    void refreshSsrTheme().then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('API недоступен — последняя известная', async () => {
    fetchTheme.mockResolvedValueOnce(found('chrono'));
    await refreshSsrTheme();
    jest.advanceTimersByTime(60_000);
    fetchTheme.mockResolvedValueOnce(UNAVAILABLE);
    await refreshSsrTheme();
    await jest.runAllTimersAsync();
    expect(ssrThemeId()).toBe('chrono');
  });

  it("незнакомая тема ('unknown') — «Классика»", async () => {
    fetchTheme.mockResolvedValue(found('unknown'));
    await refreshSsrTheme();
    expect(ssrThemeId()).toBe('classic');
  });
});

describe('пути middleware темы', () => {
  const runs = (path: string) => SSR_THEME_PATHS.some((pattern) => pattern.test(path));

  it.each([
    '/',
    '/sign-in',
    '/races/0190a6f4-0000-7000-8000-000000000009',
    '/settings/account/delete',
  ])('страница %s — да', (path) => expect(runs(path)).toBe(true));

  it.each([
    '/_expo/loaders/races/1',
    '/_expo/static/js/web/entry.js',
    '/manifest.webmanifest',
    '/sw.js',
    '/icons/icon-192.png',
    '/assets/__node_modules/font.ttf',
  ])('%s — нет', (path) => expect(runs(path)).toBe(false));
});
