/// <reference types="jest" />
import { createApiClient } from '@pokatim/api-client';

import { apiPlatformOptions } from './api-platform';
import './api';

jest.mock('@pokatim/api-client', () => ({ createApiClient: jest.fn(() => ({})) }));

describe('клиент API (web)', () => {
  it('refresh — в httpOnly cookie: credentials include, транспорт сессии cookie', () => {
    expect(apiPlatformOptions).toMatchObject({
      credentials: 'include',
      sessionTransport: 'cookie',
    });
  });

  it('запросы к API — без Referer: адрес страницы (код билета /tickets/<код>) не уходит в журналы API', async () => {
    const realFetch = global.fetch;
    const spy = jest.fn(async () => ({ ok: true }));
    global.fetch = spy as unknown as typeof fetch;
    try {
      await apiPlatformOptions.fetchImpl!('https://api.test/v1/tickets/X', {
        method: 'GET',
        credentials: 'include',
      });
    } finally {
      global.fetch = realFetch;
    }
    expect(spy).toHaveBeenCalledWith('https://api.test/v1/tickets/X', {
      method: 'GET',
      credentials: 'include',
      referrerPolicy: 'no-referrer',
    });
  });

  it('lib/api создаёт клиент с адресом API и опциями платформы', () => {
    expect(createApiClient).toHaveBeenCalledWith({
      baseUrl: expect.any(String),
      credentials: 'include',
      sessionTransport: 'cookie',
      fetchImpl: apiPlatformOptions.fetchImpl,
    });
  });
});
