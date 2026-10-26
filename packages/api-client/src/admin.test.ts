import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const me = {
  user: { id: USER_ID, displayName: 'Ольга', email: 'olga@example.by', role: 'admin' },
  permissions: ['members.read', 'members.manage', 'audit.read'],
};
const member = {
  userId: USER_ID,
  displayName: 'Ольга',
  email: 'olga@example.by',
  role: 'moderator',
  status: 'active',
  grantedAt: '2026-10-25T10:00:00.000Z',
  revokedAt: null,
};

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  body: unknown;
}

/** fetch-заглушка: запоминает запросы; `null` — пустое тело (204). */
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
    const body = response === null ? null : JSON.stringify(response);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function admin(status: number, response: unknown) {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createAdminApiClient({ baseUrl: '', fetchImpl }) };
}

describe('createAdminApiClient: пути, методы, cookie панели', () => {
  it('сессия: вход, me, выход (204)', async () => {
    const signIn = admin(200, { state: 'signedIn', me });
    await expect(signIn.api.signIn({ email: 'olga@example.by', password: 'x' })).resolves.toEqual({
      state: 'signedIn',
      me,
    });
    expect(signIn.calls[0]).toMatchObject({
      url: '/v1/admin/session/sign-in',
      method: 'POST',
      credentials: 'same-origin',
      body: { email: 'olga@example.by', password: 'x' },
    });

    const current = admin(200, me);
    await expect(current.api.me()).resolves.toEqual(me);
    expect(current.calls[0]).toMatchObject({ url: '/v1/admin/session/me', method: 'GET' });

    const signOut = admin(204, null);
    await expect(signOut.api.signOut()).resolves.toBeUndefined();
    expect(signOut.calls[0]).toMatchObject({ url: '/v1/admin/session/sign-out', method: 'POST' });
  });

  it('сотрудники: список, выдача, смена и снятие роли', async () => {
    const list = admin(200, { items: [member], truncated: false });
    await list.api.listMembers();
    expect(list.calls[0]).toMatchObject({ url: '/v1/admin/members', method: 'GET' });

    const grant = admin(201, member);
    const body = { email: 'olga@example.by', displayName: 'Ольга', role: 'moderator' as const };
    await expect(grant.api.grantRole(body)).resolves.toEqual(member);
    expect(grant.calls[0]).toMatchObject({ url: '/v1/admin/members', method: 'POST', body });

    const change = admin(200, member);
    await change.api.changeRole(USER_ID, { role: 'admin', reason: 'повышение' });
    expect(change.calls[0]).toMatchObject({
      url: `/v1/admin/members/${USER_ID}/role`,
      method: 'POST',
      body: { role: 'admin', reason: 'повышение' },
    });

    const revoke = admin(200, { ...member, status: 'revoked', revokedAt: member.grantedAt });
    await revoke.api.revokeRole(USER_ID, { reason: 'ушла из команды' });
    expect(revoke.calls[0]).toMatchObject({
      url: `/v1/admin/members/${USER_ID}/revoke`,
      method: 'POST',
    });
  });

  it('журнал: параметры фильтра и курсора — в query; пустые не уходят', async () => {
    const page = admin(200, { items: [], nextCursor: null });
    await page.api.listAudit({ limit: 50, cursor: USER_ID, action: 'panel.signed_in' });
    expect(page.calls[0]?.url).toBe(
      `/v1/admin/audit?limit=50&cursor=${USER_ID}&action=panel.signed_in`,
    );
    await page.api.listAudit({});
    expect(page.calls[1]?.url).toBe('/v1/admin/audit');
  });

  it('статус API — тот же путь, что у клиента приложения', async () => {
    const ok = { status: 'ok', version: 'dev', checks: { database: 'up' } };
    const { calls, api } = admin(200, ok);
    await expect(api.health()).resolves.toEqual(ok);
    expect(calls[0]).toMatchObject({ url: '/v1/health', method: 'GET' });
  });

  it('ни одного заголовка Authorization: панель — только cookie', async () => {
    const { calls, api } = admin(200, me);
    await api.me();
    await api.listMembers().catch(() => undefined);
    for (const call of calls) {
      expect(call.headers.has('authorization')).toBe(false);
      expect(call.credentials).toBe('same-origin');
    }
  });

  it('ответ не по схеме — ошибка, а не данные', async () => {
    const { api } = admin(200, { ...me, permissions: ['routes.manage'] });
    await expect(api.me()).rejects.toThrow();
  });

  it('resendVerification — тот же путь и тело, что у клиента приложения', async () => {
    const token = 'r'.repeat(43);
    const panel = admin(200, { resendAvailableInSec: 60 });
    await panel.api.resendVerification({ registrationToken: token });
    const app = stub(200, { resendAvailableInSec: 60 });
    await createApiClient({ baseUrl: '', fetchImpl: app.fetchImpl }).resendVerification({
      registrationToken: token,
    });
    expect(panel.calls[0]).toMatchObject({
      url: app.calls[0]?.url,
      method: app.calls[0]?.method,
      body: app.calls[0]?.body,
    });
  });
});

describe('createAdminApiClient: маршруты (race-results-01)', () => {
  const route = {
    id: USER_ID,
    title: 'Минское кольцо',
    status: 'processing',
    failure: null,
    distanceM: null,
    elevationGainM: null,
    isLoop: null,
    owner: { userId: USER_ID, displayName: 'Ольга' },
    createdAt: '2026-10-27T10:00:00.000Z',
    line: [],
  };

  it('uploadRoute — POST octet-stream с сырыми байтами, название в ?title=, cookie без Authorization', async () => {
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(route), { status: 202 }));
    }) as typeof fetch;
    const api = createAdminApiClient({ baseUrl: '', fetchImpl });
    const bytes = new Uint8Array([60, 103, 112, 120]);
    await expect(api.uploadRoute(bytes, 'Кольцо & круг')).resolves.toEqual(route);
    const call = fetchCalls[0]!;
    expect(call.url).toBe(
      '/v1/admin/routes?title=%D0%9A%D0%BE%D0%BB%D1%8C%D1%86%D0%BE+%26+%D0%BA%D1%80%D1%83%D0%B3',
    );
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toBe(bytes);
    expect(call.init?.credentials).toBe('same-origin');
    const headers = new Headers(call.init?.headers);
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(headers.has('authorization')).toBe(false);
  });

  it('listRoutes и getRoute — пути, query, строгий разбор', async () => {
    const summary = { ...route, line: undefined };
    const list = admin(200, { items: [summary], nextCursor: null });
    await list.api.listRoutes({ status: 'ready', limit: 100 });
    expect(list.calls[0]).toMatchObject({
      url: '/v1/admin/routes?status=ready&limit=100',
      method: 'GET',
      credentials: 'same-origin',
    });

    const one = admin(200, route);
    await expect(one.api.getRoute(USER_ID)).resolves.toEqual(route);
    expect(one.calls[0]).toMatchObject({ url: `/v1/admin/routes/${USER_ID}`, method: 'GET' });

    const broken = admin(200, { ...route, status: 'published' });
    await expect(broken.api.getRoute(USER_ID)).rejects.toThrow();
  });
});

describe('createAdminApiClient: модерация райдов (05b)', () => {
  const AT = '2027-06-14T07:00:00.000Z';
  const detail = {
    id: USER_ID,
    title: 'Кофе-райд',
    organizerName: null,
    startsAt: AT,
    city: 'minsk',
    place: 'Парк',
    distanceKm: 40,
    paceMinKmh: 22,
    paceMaxKmh: 25,
    limit: null,
    goingCount: 3,
    description: null,
    status: 'published',
    phase: 'upcoming',
    cancelReason: null,
    rescheduledAt: null,
    hiddenAt: null,
    openReportCount: 1,
    lastReportAt: AT,
    version: 0,
    reports: [],
  };

  it('очередь, карточка и действия — пути, тела, cookie', async () => {
    const list = admin(200, { items: [], nextCursor: null });
    await list.api.listModerationRides({ state: 'hidden', cursor: 'c' });
    expect(list.calls[0]).toMatchObject({
      url: '/v1/admin/rides?state=hidden&cursor=c',
      method: 'GET',
      credentials: 'same-origin',
    });

    const { calls, api } = admin(200, detail);
    await api.getModerationRide(USER_ID);
    await api.hideRide(USER_ID, { version: 0, reason: 'Спам' });
    await api.restoreRide(USER_ID, { version: 1, reason: 'Ошибка' });
    await api.dismissRideReports(USER_ID, { version: 0, reason: 'Норма', lastReportAt: AT });
    expect(calls.map(({ url, method, body }) => [method, url, body])).toEqual([
      ['GET', `/v1/admin/rides/${USER_ID}`, undefined],
      ['POST', `/v1/admin/rides/${USER_ID}/hide`, { version: 0, reason: 'Спам' }],
      ['POST', `/v1/admin/rides/${USER_ID}/restore`, { version: 1, reason: 'Ошибка' }],
      [
        'POST',
        `/v1/admin/rides/${USER_ID}/dismiss-reports`,
        { version: 0, reason: 'Норма', lastReportAt: AT },
      ],
    ]);
  });
});
