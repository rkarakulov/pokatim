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

describe('api-client: реакции (P4)', () => {
  const RIDE = '01890a5d-ac96-774b-bcce-b302099a8057';
  const RACE = '01890a5d-ac96-774b-bcce-b302099a8058';
  const ENTRY = '01890a5d-ac96-774b-bcce-b302099a8059';
  const participants = {
    riders: [],
    hiddenCount: 0,
    attendance: {
      state: 'attended',
      canMark: false,
      canDecline: true,
      attended: { riders: [{ name: 'Аня', publicId: PUBLIC_ID }], hiddenCount: 1 },
      allThanked: true,
    },
  };

  it('thankRideRiders — POST с { publicId }; строки «Ехали» с флагами по умолчанию', async () => {
    const { calls, api } = client(200, participants);
    const parsed = await api.thankRideRiders('t', RIDE, PUBLIC_ID);
    expect(parsed.attendance?.attended?.riders[0]).toEqual({
      name: 'Аня',
      publicId: PUBLIC_ID,
      avatar: null,
      self: false,
      thanked: false,
    });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/rides/${RIDE}/thanks`,
        method: 'POST',
        authorization: 'Bearer t',
        body: { publicId: PUBLIC_ID },
      },
    ]);
  });

  it('thankRideRiders без publicId — тело {} («Поблагодарить всех»)', async () => {
    const { calls, api } = client(200, participants);
    await api.thankRideRiders('t', RIDE);
    expect(calls[0]).toMatchObject({ method: 'POST', body: {} });
  });

  it('getRaceEntryRespect — GET; ответ по умолчанию нейтральный', async () => {
    const { calls, api } = client(200, {});
    await expect(api.getRaceEntryRespect('t', RACE, ENTRY)).resolves.toEqual({
      available: false,
      respected: false,
      count: 0,
      own: false,
      from: null,
    });
    expect(calls[0]).toEqual({
      url: `https://api.test/v1/races/${RACE}/results/${ENTRY}/respect`,
      method: 'GET',
      authorization: 'Bearer t',
      body: undefined,
    });
  });

  it('setRaceEntryRespect — PUT с { respected }', async () => {
    const { calls, api } = client(200, { available: true, respected: true, count: 4 });
    await expect(
      api.setRaceEntryRespect('t', RACE, ENTRY, { respected: true }),
    ).resolves.toMatchObject({ respected: true, count: 4 });
    expect(calls[0]).toEqual({
      url: `https://api.test/v1/races/${RACE}/results/${ENTRY}/respect`,
      method: 'PUT',
      authorization: 'Bearer t',
      body: { respected: true },
    });
  });

  it('getRouteRespect и setRouteRespect — путь маршрута; 404 — ошибка', async () => {
    const got = client(200, { own: true, count: 2, from: { riders: [], hiddenCount: 2 } });
    await expect(got.api.getRouteRespect('t', RIDE)).resolves.toMatchObject({
      own: true,
      from: { riders: [], hiddenCount: 2 },
    });
    expect(got.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/${RIDE}/respect`,
      method: 'GET',
    });
    const set = client(404, { code: 'NOT_FOUND', message: 'x' });
    const error = (await set.api
      .setRouteRespect('t', RIDE, { respected: false })
      .catch((e: unknown) => e)) as ApiHttpError;
    expect(error.status).toBe(404);
    expect(set.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/${RIDE}/respect`,
      method: 'PUT',
      body: { respected: false },
    });
  });
});

describe('api-client: Главная «Свои» (P7)', () => {
  it('getSocialHome — GET с Bearer; незнакомый вид строки отброшен', async () => {
    const { calls, api } = client(200, { items: [{ kind: 'photo' }] });
    await expect(api.getSocialHome('t')).resolves.toEqual({ items: [] });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/social/home',
        method: 'GET',
        authorization: 'Bearer t',
        body: undefined,
      },
    ]);
  });
});
