import { describe, expect, it } from 'vitest';

import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

const PUBLIC_ID = 'a-'.repeat(21) + 'b';

const riderSocial = {
  self: false,
  connected: true,
  together: { rideCount: 2, lastRideAt: '2026-10-10T07:00:00.000Z' },
};

function client(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: «Свои» на профиле (P3)', () => {
  it('getRiderSocial — GET с Bearer; going по умолчанию null', async () => {
    const { calls, api } = client(200, riderSocial);
    await expect(api.getRiderSocial('t', PUBLIC_ID)).resolves.toEqual({
      ...riderSocial,
      going: null,
    });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/riders/${PUBLIC_ID}/social`,
        method: 'GET',
        authorization: 'Bearer t',
        body: undefined,
      },
    ]);
  });

  it('getRiderSocial — publicId кодируется в пути', async () => {
    const { calls, api } = client(200, riderSocial);
    await api.getRiderSocial('t', 'a/b?c');
    expect(calls[0]?.url).toBe('https://api.test/v1/riders/a%2Fb%3Fc/social');
  });

  it('setRiderConnection — PUT с телом { connected }; ответ — RiderSocial', async () => {
    const { calls, api } = client(200, { ...riderSocial, connected: false });
    await expect(
      api.setRiderConnection('t', PUBLIC_ID, { connected: false }),
    ).resolves.toMatchObject({ connected: false, going: null });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/riders/${PUBLIC_ID}/social/connection`,
        method: 'PUT',
        authorization: 'Bearer t',
        body: { connected: false },
      },
    ]);
  });

  it('setRiderConnection — 429 RATE_LIMITED приходит ошибкой с кодом', async () => {
    const { api } = client(429, {
      code: 'RATE_LIMITED',
      message: 'x',
      details: { retryAfterSec: 60 },
    });
    const error = (await api
      .setRiderConnection('t', PUBLIC_ID, { connected: true })
      .catch((e: unknown) => e)) as ApiHttpError;
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error.status).toBe(429);
    expect(error.apiError.code).toBe('RATE_LIMITED');
  });

  it('listSocialConnections — GET с Bearer; источники tolerant', async () => {
    const row = {
      publicId: PUBLIC_ID,
      name: 'Анна К.',
      avatar: null,
      rideCount: 0,
      lastRideAt: null,
      sources: ['manual', 'future'],
    };
    const { calls, api } = client(200, { items: [row], count: 1 });
    await expect(api.listSocialConnections('t')).resolves.toEqual({
      items: [{ ...row, sources: ['manual', 'unknown'] }],
      count: 1,
    });
    expect(calls[0]).toMatchObject({
      url: 'https://api.test/v1/social/connections',
      method: 'GET',
      authorization: 'Bearer t',
    });
  });
});
