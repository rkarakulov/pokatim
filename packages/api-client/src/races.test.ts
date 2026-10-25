import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  body: unknown;
}

function stub(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(response === null ? null : JSON.stringify(response), { status }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const season = {
  id: ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 0,
  version: 0,
};
const panelRace = {
  id: ID,
  status: 'draft',
  phase: 'draft',
  title: 'Минское кольцо',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 42,
  description: null,
  windowStartsAt: '2026-10-04T21:00:00.000Z',
  windowEndsAt: '2026-10-12T20:59:00.000Z',
  protocolPlannedAt: '2026-10-14T20:59:00.000Z',
  season: null,
  owner: { userId: ID, displayName: 'Ольга' },
  cancelReason: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: null,
  cancelledAt: null,
  version: 0,
  editable: { fields: [], canPublish: true, canCancel: false, canDiscard: true, reasons: [] },
};
const calendarStart = {
  id: ID,
  status: 'published',
  title: 'Гран-при',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  place: null,
  distancesKm: [100],
  registrationUrl: null,
  description: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  version: 0,
};

function admin(status: number, response: unknown) {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createAdminApiClient({ baseUrl: '', fetchImpl }) };
}
type AdminApi = ReturnType<typeof admin>['api'];

describe('панель: сезоны, гонки, календарь', () => {
  it('сезоны: список, создание, изменение', async () => {
    const list = admin(200, { items: [season] });
    await list.api.listSeasons();
    const create = admin(201, season);
    const body = { name: 'Сезон 2026', startsOn: '2026-04-01', endsOn: '2026-10-31' };
    await create.api.createSeason(body);
    const update = admin(200, season);
    await update.api.updateSeason(ID, { version: 0, name: 'Сезон' });
    expect([list.calls[0], create.calls[0], update.calls[0]]).toMatchObject([
      { url: '/v1/admin/seasons', method: 'GET', credentials: 'same-origin' },
      { url: '/v1/admin/seasons', method: 'POST', body },
      { url: `/v1/admin/seasons/${ID}`, method: 'POST', body: { version: 0, name: 'Сезон' } },
    ]);
  });

  it('гонки: пути действий, фильтры в query, удаление — 204', async () => {
    const list = admin(200, { items: [panelRace], nextCursor: null });
    await list.api.listRaces({ status: 'draft', mine: true, limit: 50 });
    expect(list.calls[0]?.url).toBe('/v1/admin/races?status=draft&mine=true&limit=50');

    const actions: [string, string, (api: AdminApi) => Promise<unknown>][] = [
      ['', 'GET', (api) => api.getRace(ID)],
      ['', 'POST', (api) => api.updateRace(ID, { version: 1 })],
      ['/publish', 'POST', (api) => api.publishRace(ID, { version: 1 })],
      ['/cancel', 'POST', (api) => api.cancelRace(ID, { version: 1, reason: 'weather' })],
    ];
    for (const [suffix, method, run] of actions) {
      const client = admin(200, panelRace);
      await run(client.api);
      expect(client.calls[0]).toMatchObject({ url: `/v1/admin/races/${ID}${suffix}`, method });
    }

    const discard = admin(204, null);
    await expect(discard.api.discardRace(ID, { version: 2 })).resolves.toBeUndefined();
    expect(discard.calls[0]).toMatchObject({
      url: `/v1/admin/races/${ID}/discard`,
      method: 'POST',
      body: { version: 2 },
    });
  });

  it('календарь: список, снятие и возврат', async () => {
    const list = admin(200, { items: [calendarStart], nextCursor: null });
    await list.api.listCalendar({ status: 'published' });
    expect(list.calls[0]?.url).toBe('/v1/admin/calendar?status=published');
    const unpublish = admin(200, { ...calendarStart, status: 'unpublished' });
    await unpublish.api.unpublishCalendarStart(ID, { version: 0, reason: 'Старт перенесён' });
    const republish = admin(200, calendarStart);
    await republish.api.republishCalendarStart(ID, { version: 1 });
    expect([unpublish.calls[0], republish.calls[0]]).toMatchObject([
      { url: `/v1/admin/calendar/${ID}/unpublish`, method: 'POST' },
      { url: `/v1/admin/calendar/${ID}/republish`, method: 'POST' },
    ]);
  });
});

describe('приложение: публичное чтение без Authorization', () => {
  const app = (status: number, response: unknown) => {
    const { calls, fetchImpl } = stub(status, response);
    return {
      calls,
      api: createApiClient({ baseUrl: 'https://api.test', fetchImpl, getAccessToken: () => 'jwt' }),
    };
  };

  it('массивы фильтров — повтором ключа; токен не уходит', async () => {
    const races = app(200, { items: [], nextCursor: null });
    await races.api.listRaces({
      scope: 'past',
      bikeClass: ['road', 'gravel'],
      month: ['2026-10'],
    });
    expect(races.calls[0]?.url).toBe(
      'https://api.test/v1/races?scope=past&bikeClass=road&bikeClass=gravel&month=2026-10',
    );
    expect(races.calls[0]?.headers.has('authorization')).toBe(false);

    const calendar = app(200, { items: [], nextCursor: null });
    await calendar.api.listCalendar({ city: ['Минск'], limit: 1 });
    expect(calendar.calls[0]?.url).toBe(
      `https://api.test/v1/calendar?city=${encodeURIComponent('Минск')}&limit=1`,
    );
    expect(calendar.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('сезон, карточка старта, города', async () => {
    const current = app(200, { season: null });
    await expect(current.api.getCurrentSeason()).resolves.toEqual({ season: null });
    const cities = app(200, { cities: ['Минск'] });
    await cities.api.listCalendarCities();
    const start = app(200, { ...calendarStart, discipline: 'cyclocross' });
    await expect(start.api.getCalendarStart(ID)).resolves.toMatchObject({ discipline: 'unknown' });
    expect([current.calls[0]?.url, cities.calls[0]?.url, start.calls[0]?.url]).toEqual([
      'https://api.test/v1/seasons/current',
      'https://api.test/v1/calendar/cities',
      `https://api.test/v1/calendar/${ID}`,
    ]);
    for (const call of [...current.calls, ...cities.calls, ...start.calls]) {
      expect(call.method).toBe('GET');
      expect(call.headers.has('authorization')).toBe(false);
    }
  });

  it('404 гонки — ApiHttpError со статусом', async () => {
    const missing = app(404, { code: 'NOT_FOUND', message: 'Не найдено' });
    await expect(missing.api.getRace(ID)).rejects.toMatchObject({ status: 404 });
  });
});
