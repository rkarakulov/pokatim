/// <reference types="jest" />
import { resetPublicSsrCache } from '@/lib/public-ssr';

import { refreshSsrTheme, ssrThemeId } from './ssr-theme';

// настоящий путь `fetchPublicForSsr` (без мока модуля): подменён только `fetch`, время — управляемое
const KEY = Symbol.for('pokatim.appTheme');
const holder = globalThis as Record<symbol, unknown>;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
let apiTheme = 'atlas';
const RESPONSE_MS = 500;

beforeEach(() => {
  resetPublicSsrCache();
  jest.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z') });
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.API_INTERNAL_URL = 'http://api.internal:3000';
  apiTheme = 'atlas';
  // ответ API приходит через RESPONSE_MS: окно не должно отсчитываться от начала запроса
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        const body = JSON.stringify({ themeId: apiTheme });
        setTimeout(() => resolve(new Response(body, { status: 200 })), RESPONSE_MS);
      }),
  );
});
afterEach(() => {
  delete holder[KEY];
  fetchMock.mockReset();
  jest.useRealTimers();
  delete process.env.API_INTERNAL_URL;
});

/** Страница: middleware + немного времени на фоновый запрос. */
async function page(): Promise<void> {
  const pending = refreshSsrTheme();
  await jest.advanceTimersByTimeAsync(RESPONSE_MS);
  await pending;
}

describe('тема SSR на настоящем fetchPublicForSsr', () => {
  it('смена темы на API видна не позже ~60 с после прошлой попытки (кэш публичных данных не удваивает окно)', async () => {
    await page();
    expect(ssrThemeId()).toBe('atlas');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    apiTheme = 'journal';
    // страницы идут каждую секунду; ответ виден, как только прошло окно от завершения прошлой попытки
    let seenAt: number | null = null;
    for (let second = 1; second <= 70 && seenAt === null; second += 1) {
      await jest.advanceTimersByTimeAsync(1_000 - RESPONSE_MS);
      await page();
      if (ssrThemeId() === 'journal') seenAt = second;
    }
    expect(seenAt).not.toBeNull();
    expect(seenAt!).toBeLessThanOrEqual(61);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сбои API подряд — не чаще одного обращения за 60 с', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    for (let second = 0; second < 59; second += 1) {
      await page();
      await jest.advanceTimersByTimeAsync(1_000 - RESPONSE_MS);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ssrThemeId()).toBe('classic');
  });
});
