import { describe, expect, it } from 'vitest';

import { createApiClient } from './index.ts';

function client(status: number, response: unknown) {
  const calls: { url: string; method?: string; authorization: string | null }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: код приглашения (social P6)', () => {
  it('getInviteCode — GET с Bearer, ответ проходит схему', async () => {
    const { calls, api } = client(200, { code: 'K7M2PQX' });
    await expect(api.getInviteCode('access.jwt.x')).resolves.toEqual({ code: 'K7M2PQX' });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/social/invite-code',
        method: 'GET',
        authorization: 'Bearer access.jwt.x',
      },
    ]);
  });

  it('getInviteCode — код не по формату отклоняется', async () => {
    const { api } = client(200, { code: 'bad' });
    await expect(api.getInviteCode('access.jwt.x')).rejects.toThrow();
  });
});
