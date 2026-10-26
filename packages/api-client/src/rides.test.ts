import { describe, expect, it } from 'vitest';

import { ApiHttpError, apiErrorOf, createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

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

const detail = {
  id: ID,
  title: 'Кофе-райд',
  organizerName: null,
  startsAt: '2027-06-14T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  description: null,
};
const viewer = { role: 'participant', canJoin: false, canLeave: true, canManage: false };
const view = { ride: detail, viewer };

describe('api-client: кофе-райды', () => {
  it('getRide — публично, без Bearer', async () => {
    const { calls, api } = client(200, detail);
    await expect(api.getRide(ID)).resolves.toMatchObject({ id: ID, phase: 'upcoming' });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/rides/${ID}`,
        method: 'GET',
        authorization: null,
        body: undefined,
      },
    ]);
  });

  it('listRides — Bearer, город массивом, курсор; listRideCities — незнакомые города отброшены', async () => {
    const page = client(200, { items: [{ ...detail, viewer }], nextCursor: null });
    await page.api.listRides('t', { city: ['minsk', 'brest'], limit: 20, cursor: 'c1' });
    expect(page.calls[0]).toEqual({
      url: 'https://api.test/v1/rides?city=minsk&city=brest&limit=20&cursor=c1',
      method: 'GET',
      authorization: 'Bearer t',
      body: undefined,
    });
    const cities = client(200, { cities: ['minsk', 'atlantis'] });
    await expect(cities.api.listRideCities('t')).resolves.toEqual({ cities: ['minsk'] });
    expect(cities.calls[0]?.authorization).toBe('Bearer t');
  });

  it('getRideForViewer и мутации — Bearer, пути и тела', async () => {
    const { calls, api } = client(200, view);
    await api.getRideForViewer('t', ID);
    await api.joinRide('t', ID);
    await api.leaveRide('t', ID);
    await api.cancelRide('t', ID, { reason: 'weather' });
    await api.updateRide('t', ID, { version: 1, title: 'Новый' });
    expect(calls.map(({ url, method, body }) => [method, url, body])).toEqual([
      ['GET', `https://api.test/v1/rides/${ID}/me`, undefined],
      ['POST', `https://api.test/v1/rides/${ID}/join`, {}],
      ['POST', `https://api.test/v1/rides/${ID}/leave`, {}],
      ['POST', `https://api.test/v1/rides/${ID}/cancel`, { reason: 'weather' }],
      ['POST', `https://api.test/v1/rides/${ID}`, { version: 1, title: 'Новый' }],
    ]);
    expect(new Set(calls.map((call) => call.authorization))).toEqual(new Set(['Bearer t']));
  });

  it('createRide — 201 RideView; RIDE_FULL — ApiHttpError с кодом', async () => {
    const created = client(201, { ...view, ride: { ...detail, version: 0 } });
    await expect(
      created.api.createRide('t', {
        title: 'Кофе-райд',
        organizerName: null,
        startsAt: '2027-06-14T07:00:00Z',
        cityCode: 'minsk',
        place: 'Парк Победы',
        distanceKm: 42,
        paceMinKmh: 22,
        paceMaxKmh: 24,
        limit: 12,
        description: null,
      }),
    ).resolves.toMatchObject({ ride: { version: 0 } });
    expect(created.calls[0]?.url).toBe('https://api.test/v1/rides');

    const full = client(409, { code: 'RIDE_FULL', message: 'x' });
    const error = await full.api.joinRide('t', ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(apiErrorOf(error)?.code).toBe('RIDE_FULL');
  });
});
