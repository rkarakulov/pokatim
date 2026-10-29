/// <reference types="jest" />
import type * as ExpoServer from 'expo-server';
import { requestHeaders } from 'expo-server';

import { cspNonce } from './csp-nonce';

// заголовки запроса задаёт тест (как в ssr-theme.test.ts)
jest.mock('expo-server', () => ({ requestHeaders: jest.fn() }));

const headers = jest.mocked(requestHeaders);

afterEach(() => headers.mockReset());

describe('cspNonce — nonce CSP запроса для +html.tsx (ADR-0025)', () => {
  it('заголовок web-сервера — его значение', () => {
    headers.mockReturnValue(new Headers({ 'x-pokatim-csp-nonce': 'abc==' }) as never);
    expect(cspNonce()).toBe('abc==');
  });

  it('нет заголовка — undefined', () => {
    headers.mockReturnValue(new Headers() as never);
    expect(cspNonce()).toBeUndefined();
  });

  it('настоящий expo-server вне запроса (dev-сервер, jest) — undefined', () => {
    const actual = jest.requireActual<typeof ExpoServer>('expo-server');
    headers.mockImplementation(actual.requestHeaders);
    expect(cspNonce()).toBeUndefined();
  });
});
