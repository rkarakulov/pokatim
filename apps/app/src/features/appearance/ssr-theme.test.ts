/// <reference types="jest" />
import type * as ExpoServer from 'expo-server';
import { requestHeaders } from 'expo-server';

import { ssrThemeId } from './ssr-theme';

// expo-server: `requestHeaders()` — заголовки текущего запроса из контекста адаптера (AsyncLocalStorage); вне запроса —
// исключение. Здесь — подмена: заголовки задаёт тест
jest.mock('expo-server', () => ({ requestHeaders: jest.fn() }));

const headers = jest.mocked(requestHeaders);
const withCookie = (cookie?: string) =>
  headers.mockReturnValue(new Headers(cookie === undefined ? {} : { cookie }) as never);

afterEach(() => headers.mockReset());

describe('ssrThemeId — тема из cookie запроса (user-theme, A7)', () => {
  it('валидная cookie pokatim_theme — её тема', () => {
    withCookie('pokatim_theme=atlas');
    expect(ssrThemeId()).toBe('atlas');
  });

  it('cookie среди других, с пробелами', () => {
    withCookie('sid=abc; pokatim_theme=chrono ;other=1');
    expect(ssrThemeId()).toBe('chrono');
  });

  it.each([
    ['нет cookie', undefined],
    ['пустой заголовок', ''],
    ['чужие cookie', 'sid=abc; theme=atlas'],
    ['незнакомый id', 'pokatim_theme=neon'],
    ['регистр', 'pokatim_theme=ATLAS'],
    ['мусор', 'pokatim_theme=%3Cscript%3E'],
    ['без значения', 'pokatim_theme'],
    ['пустое значение', 'pokatim_theme='],
    ['очень длинный заголовок', `pokatim_theme=${'a'.repeat(100_000)}`],
  ])('%s — «Классика»', (_, cookie) => {
    withCookie(cookie);
    expect(ssrThemeId()).toBe('classic');
  });

  it('несколько cookie с тем же именем — первая валидная', () => {
    withCookie('pokatim_theme=neon; pokatim_theme=journal; pokatim_theme=atlas');
    expect(ssrThemeId()).toBe('journal');
  });

  it('requestHeaders бросает (вне запроса: dev-сервер, jest) — «Классика»', () => {
    headers.mockImplementation(() => {
      throw new Error('Runtime APIs can only be called during ongoing requests');
    });
    expect(ssrThemeId()).toBe('classic');
  });

  it('настоящий expo-server вне запроса — «Классика»', () => {
    const actual = jest.requireActual<typeof ExpoServer>('expo-server');
    headers.mockImplementation(actual.requestHeaders);
    expect(ssrThemeId()).toBe('classic');
  });
});
