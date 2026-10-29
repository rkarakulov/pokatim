import { describe, expect, it } from 'vitest';

import { ApiHttpError, ApiNetworkError, createApiClient, isNetworkError } from './index.ts';

const ok = { status: 'ok', version: 'dev', checks: { database: 'up' } };
const respond = (status: number, body: unknown) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

describe('api-client: health и классы ошибок (реэкспорт базы)', () => {
  it('ответ валиден — данные по схеме', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: respond(200, ok) });
    await expect(api.health()).resolves.toEqual(ok);
  });

  it('клиент бросает те же классы, что экспортирует пакет: сеть и HTTP различимы', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    const network = await createApiClient({ baseUrl: '', fetchImpl })
      .health()
      .catch((e: unknown) => e);
    expect(network).toBeInstanceOf(ApiNetworkError);
    expect(isNetworkError(network)).toBe(true);

    const http = await createApiClient({ baseUrl: '', fetchImpl: respond(503, null) })
      .health()
      .catch((e: unknown) => e);
    expect(http).toBeInstanceOf(ApiHttpError);
    expect(isNetworkError(http)).toBe(false);
  });
});

describe('api-client: тема приложения (app-themes)', () => {
  it('GET /v1/appearance — публично, незнакомая тема — unknown', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ themeId: 'future' }), { status: 200 }));
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    await expect(api.getAppearance()).resolves.toEqual({ themeId: 'unknown' });
    expect(calls[0]?.url).toBe('https://api.test/v1/appearance');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(new Headers(calls[0]?.init?.headers).has('authorization')).toBe(false);
  });

  it('ответ сервера user-theme — тема всегда classic, декор как есть', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ themeId: 'classic', decor: 'halloween' }), { status: 200 }),
      )) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    await expect(api.getAppearance()).resolves.toEqual({ themeId: 'classic', decor: 'halloween' });
  });
});
