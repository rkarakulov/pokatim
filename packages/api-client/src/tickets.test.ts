import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const event = {
  kind: 'race',
  id: ID,
  title: 'Минское кольцо',
  startsAt: '2026-10-24T07:00:00.000Z',
  endsAt: null,
  place: 'Парк Победы',
  address: null,
  city: null,
};
const ref = { code: '7XK2M9PQRT', status: 'active', past: false, event };

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  credentials: RequestCredentials | undefined;
  cache: RequestCache | undefined;
  body: unknown;
}

function stub(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      credentials: init?.credentials,
      cache: init?.cache,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const app = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
};

describe('api-client: билеты приложения (event-tickets)', () => {
  it('getRaceTicket — GET с Bearer; null — нет билета', async () => {
    const { calls, api } = app(200, null);
    await expect(api.getRaceTicket('a.b.c', ID)).resolves.toBeNull();
    expect(calls[0]).toMatchObject({
      url: `https://api.test/v1/races/${ID}/ticket`,
      method: 'GET',
      authorization: 'Bearer a.b.c',
    });
    const withTicket = app(200, ref);
    await expect(withTicket.api.getRaceTicket('a.b.c', ID)).resolves.toEqual(ref);
  });

  it('регистрация календаря: GET, POST с дистанцией, отмена', async () => {
    const state = { registration: null, ticket: null };
    const { calls, api } = app(201, state);
    await api.getCalendarRegistration('t.o.k', ID);
    await api.registerForCalendar('t.o.k', ID, { distanceKm: 42.2 });
    await api.cancelCalendarRegistration('t.o.k', ID);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['GET', `https://api.test/v1/calendar/${ID}/registration`, undefined],
      ['POST', `https://api.test/v1/calendar/${ID}/registration`, { distanceKm: 42.2 }],
      ['POST', `https://api.test/v1/calendar/${ID}/registration/cancel`, {}],
    ]);
    expect(calls.every((call) => call.authorization === 'Bearer t.o.k')).toBe(true);
  });

  it('listTickets и getTicket — с Bearer; незнакомый статус — unknown', async () => {
    const list = app(200, { upcoming: [{ ...ref, status: 'transferred' }], past: [] });
    await expect(list.api.listTickets('t.o.k')).resolves.toEqual({
      upcoming: [{ ...ref, status: 'unknown' }],
      past: [],
    });
    const view = {
      ...ref,
      participantName: 'Участник',
      category: null,
      qr: null,
      instructions: null,
      checkedInAt: null,
    };
    const one = app(200, view);
    await expect(one.api.getTicket('t.o.k', '7XK2M-9PQRT')).resolves.toEqual(view);
    expect(one.calls[0]?.url).toBe('https://api.test/v1/tickets/7XK2M-9PQRT');
  });

  it('getEventTicketing — публично, без Authorization', async () => {
    const pub = stub(200, { enabled: false });
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'secret.jwt.x',
      fetchImpl: pub.fetchImpl,
    });
    await expect(client.getEventTicketing('calendar', ID)).resolves.toEqual({ enabled: false });
    expect(pub.calls[0]).toMatchObject({
      url: `https://api.test/v1/events/calendar/${ID}/ticketing`,
      authorization: null,
    });
  });

  it('getEventTicketing: fresh — в обход HTTP-кэша (`cache: no-cache`) после регистрации и 409, URL тот же', async () => {
    const plain = app(200, { enabled: false });
    await plain.api.getEventTicketing('calendar', ID);
    const fresh = app(200, { enabled: false });
    await fresh.api.getEventTicketing('calendar', ID, { fresh: true });
    expect(plain.calls[0]?.cache).toBeUndefined();
    expect(fresh.calls[0]?.cache).toBe('no-cache');
    expect(fresh.calls[0]?.url).toBe(plain.calls[0]?.url);
  });
});

describe('api-client панели: билеты (event-tickets)', () => {
  const settings = {
    kind: 'race',
    eventId: ID,
    enabled: true,
    startsAt: event.startsAt,
    endsAt: null,
    place: 'Парк Победы',
    address: null,
    instructions: null,
    capacity: null,
    version: 1,
    updatedAt: event.startsAt,
    registeredCount: 0,
    activeTickets: 3,
    checkedIn: 1,
    reminders: [],
  };

  it('настройки: GET и PUT с cookie панели', async () => {
    const { calls, fetchImpl } = stub(200, settings);
    const api = createAdminApiClient({ baseUrl: '', fetchImpl });
    await expect(api.getEventTicketing('race', ID)).resolves.toEqual(settings);
    await api.updateEventTicketing('race', ID, { enabled: false, version: 1 });
    expect(calls.map((call) => [call.method, call.url, call.credentials, call.body])).toEqual([
      ['GET', `/v1/admin/events/race/${ID}/ticketing`, 'same-origin', undefined],
      [
        'PUT',
        `/v1/admin/events/race/${ID}/ticketing`,
        'same-origin',
        { enabled: false, version: 1 },
      ],
    ]);
  });

  it('участники с курсором; lookup и check-in', async () => {
    const page = stub(200, { items: [], nextCursor: null });
    await createAdminApiClient({ baseUrl: '', fetchImpl: page.fetchImpl }).listEventTickets(
      'calendar',
      ID,
      { cursor: ID, limit: 20 },
    );
    expect(page.calls[0]?.url).toBe(
      `/v1/admin/events/calendar/${ID}/tickets?cursor=${ID}&limit=20`,
    );

    const view = {
      outcome: 'checked_in',
      ticket: {
        code: ref.code,
        status: 'checked_in',
        participantName: 'Участник',
        category: null,
        event,
        checkedInAt: event.startsAt,
        checkedInBy: 'Ольга',
      },
    };
    const scan = stub(200, view);
    const api = createAdminApiClient({ baseUrl: '', fetchImpl: scan.fetchImpl });
    await api.lookupTicket({ code: ref.code });
    await expect(api.checkInTicket({ qr: `PKT1.${'a'.repeat(43)}` })).resolves.toEqual(view);
    expect(scan.calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', '/v1/admin/tickets/lookup'],
      ['POST', '/v1/admin/tickets/check-in'],
    ]);
  });
});
