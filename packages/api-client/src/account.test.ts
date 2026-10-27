import { describe, expect, it } from 'vitest';

import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  authorization: string | null;
  body: unknown;
}

/** fetch-заглушка: `null` — пустое тело (204). */
function client(status: number, response: unknown, credentials?: RequestCredentials) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const body = response === null ? null : JSON.stringify(response);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl, credentials }) };
}

describe('api-client: удаление аккаунта', () => {
  it('deleteAccount — POST /v1/account/delete с Bearer и паролем, 204 → undefined', async () => {
    const { calls, api } = client(204, null);
    await expect(api.deleteAccount('access.jwt.x', { password: 'secret' })).resolves.toBe(
      undefined,
    );
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/account/delete',
        method: 'POST',
        credentials: undefined,
        authorization: 'Bearer access.jwt.x',
        body: { password: 'secret' },
      },
    ]);
  });

  it('web: credentials клиента передаются (сервер сбрасывает cookie сессии)', async () => {
    const { calls, api } = client(204, null, 'include');
    await api.deleteAccount('t', { password: 'x' });
    expect(calls[0]?.credentials).toBe('include');
  });

  it.each([
    [403, 'PASSWORD_INCORRECT'],
    [409, 'ACCOUNT_PANEL_MEMBER'],
    [429, 'RATE_LIMITED'],
  ] as const)('%i %s — ApiHttpError с кодом', async (status, code) => {
    const details = code === 'RATE_LIMITED' ? { retryAfterSec: 60 } : undefined;
    const error = (await client(status, { code, message: 'x', details })
      .api.deleteAccount('t', { password: 'x' })
      .catch((e: unknown) => e)) as ApiHttpError;
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error.status).toBe(status);
    expect(error.apiError.code).toBe(code);
  });
});
