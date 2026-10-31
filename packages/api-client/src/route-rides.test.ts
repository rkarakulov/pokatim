import { describe, expect, it } from 'vitest';

import { createApiClient } from './index.ts';

const ROUTE = '01890a5d-ac96-774b-bcce-b302099a8057';
const RIDE = '01890a5d-ac96-774b-bcce-b302099a8058';
const AT = '2026-10-27T10:00:00.000Z';

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

const app = (status: number, response: unknown) => {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return {
    calls,
    api: createApiClient({ baseUrl: 'https://api.test', fetchImpl, getAccessToken: () => 'jwt' }),
  };
};

const activity = { startedAt: AT, source: 'upload', elapsedSec: 900, distanceM: 8000 };
const route = { id: ROUTE, title: 'Маршрут', distanceM: 8000 };
const detail = {
  id: RIDE,
  route,
  status: 'queued',
  reason: null,
  failure: null,
  elapsedSec: null,
  routeDistanceM: null,
  activity,
  comparison: {
    best: null,
    isBest: false,
    deltaToBestSec: null,
    previous: null,
    deltaToPreviousSec: null,
  },
  createdAt: AT,
  checkedAt: null,
};

describe('приложение: заезд по маршруту (route-rides-01)', () => {
  it('список, кандидаты, деталь и трек — GET с Bearer по своим путям, id в пути кодируются', async () => {
    const page = app(200, {
      route,
      summary: { count: 0, passedCount: 0, best: null },
      items: [],
    });
    await expect(page.api.listRouteRides('access', ROUTE)).resolves.toMatchObject({ route });
    const candidates = app(200, { items: [] });
    await expect(candidates.api.listRouteRideCandidates('access', ROUTE)).resolves.toEqual({
      items: [],
    });
    const one = app(200, detail);
    await expect(one.api.getRouteRide('access', ROUTE, RIDE)).resolves.toMatchObject({ id: RIDE });
    const track = app(200, {
      rideId: RIDE,
      line: [
        [27.5, 53.9],
        [27.6, 53.95],
      ],
      segment: null,
      offRuns: [],
      marks: 'pending',
    });
    await expect(track.api.getRouteRideTrack('access', ROUTE, RIDE)).resolves.toMatchObject({
      marks: 'pending',
    });
    const odd = app(200, { items: [] });
    await odd.api.listRouteRideCandidates('access', 'a/b');

    const calls = [page, candidates, one, track, odd].map((client) => client.calls[0]!);
    expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
      { url: `https://api.test/v1/routes/${ROUTE}/rides`, method: 'GET' },
      { url: `https://api.test/v1/routes/${ROUTE}/rides/candidates`, method: 'GET' },
      { url: `https://api.test/v1/routes/${ROUTE}/rides/${RIDE}`, method: 'GET' },
      { url: `https://api.test/v1/routes/${ROUTE}/rides/${RIDE}/track`, method: 'GET' },
      { url: 'https://api.test/v1/routes/a%2Fb/rides/candidates', method: 'GET' },
    ]);
    for (const call of calls) expect(call.headers.get('authorization')).toBe('Bearer access');
  });

  it('проверить заезд — POST с телом-намерением и Bearer; ответ — деталь (незнакомый статус — unknown)', async () => {
    const client = app(201, { ...detail, status: 'appealed' });
    await expect(
      client.api.checkRouteRide('access', ROUTE, { activityId: RIDE }),
    ).resolves.toMatchObject({ status: 'unknown' });
    expect(client.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/${ROUTE}/rides`,
      method: 'POST',
      body: { activityId: RIDE },
    });
    expect(client.calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });

  it('невалидный ответ и 409 — ошибка', async () => {
    const invalid = app(200, { ...detail, id: 'x' });
    await expect(invalid.api.getRouteRide('access', ROUTE, RIDE)).rejects.toBeDefined();
    const busy = app(409, { code: 'ROUTE_RIDE_NOT_READY', message: 'Заезд ещё обрабатывается' });
    await expect(
      busy.api.checkRouteRide('access', ROUTE, { uploadId: RIDE }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('приложение: таблица «Другие» (route-rides-04)', () => {
  const table = {
    rows: [{ place: 1, elapsedSec: 780, rideDate: '2026-10-27', riderName: 'Анна К.' }],
    total: 1,
    me: null,
    shared: false,
  };

  it('GET …/rides/leaderboard с Bearer; limit — в query, без params — без query', async () => {
    const withLimit = app(200, table);
    await expect(
      withLimit.api.getRouteRideLeaderboard('access', ROUTE, { limit: 5 }),
    ).resolves.toEqual({
      ...table,
      rows: [{ ...table.rows[0], riderPublicId: null, riderAvatar: null, rideId: null }],
    });
    const plain = app(200, table);
    await plain.api.getRouteRideLeaderboard('access', ROUTE);
    const calls = [withLimit, plain].map((client) => client.calls[0]!);
    expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
      { url: `https://api.test/v1/routes/${ROUTE}/rides/leaderboard?limit=5`, method: 'GET' },
      { url: `https://api.test/v1/routes/${ROUTE}/rides/leaderboard`, method: 'GET' },
    ]);
    for (const call of calls) expect(call.headers.get('authorization')).toBe('Bearer access');
  });

  it('ответ не по схеме (дата с временем суток) — ошибка', async () => {
    const bad = app(200, { ...table, rows: [{ ...table.rows[0], rideDate: AT }] });
    await expect(bad.api.getRouteRideLeaderboard('access', ROUTE)).rejects.toThrow();
  });
});
