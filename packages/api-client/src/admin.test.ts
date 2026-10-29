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

  it('«Обзор»: GET /v1/admin/overview, блоки без права отсутствуют в ответе', async () => {
    const body = { attention: { protocols: { awaiting: 1, checked: 1, ready: 1, blockers: 0 } } };
    const { calls, api } = admin(200, body);
    await expect(api.overview()).resolves.toEqual(body);
    expect(calls[0]).toMatchObject({ url: '/v1/admin/overview', method: 'GET' });
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
    catalog: null,
    line: [],
    elevation: null,
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

describe('createAdminApiClient: протокол гонки (race-results-05)', () => {
  const AT = '2026-10-28T10:00:00.000Z';
  const RACE = `/v1/admin/races/${USER_ID}`;
  const checklist = [
    'open_disputes',
    'unprocessed_tracks',
    'checks_queued',
    'checks_failed',
    'window_open',
  ].map((code) => ({ code, count: 0 }));
  const summary = {
    raceId: USER_ID,
    lockedAt: null,
    engineVersion: 1,
    counts: {
      entries: 0,
      active: 0,
      withdrawn: 0,
      ranked: 0,
      attempts: {
        queued: 0,
        checking: 0,
        counted: 0,
        rejected: 0,
        failed: 0,
        withdrawn: 0,
        excluded: 0,
      },
      hidden: 0,
      failed: 0,
      staleEngine: 0,
      attention: 0,
      finishers: 0,
    },
    groupScheme: null,
    phase: 'final',
    uploadClosesAt: AT,
    protocol: { publishedAt: AT, revision: 1, ranked: 0, disqualified: 0, recheckPending: false },
    recheck: null,
    publish: { canPublish: false, blockedBy: 'published', checklist },
  };
  const attempt = {
    id: USER_ID,
    entryId: USER_ID,
    userId: USER_ID,
    activityId: USER_ID,
    origin: 'auto',
    status: 'excluded',
    hidden: false,
    reasons: [],
    failure: null,
    withdrawReason: null,
    segment: null,
    engineVersion: 1,
    checkRevision: 1,
    checkAttempts: 1,
    diagnostics: null,
    createdAt: AT,
    checkedAt: AT,
    review: { kind: 'excluded', reason: 'Чужой трек', at: AT },
    riderName: 'Анна К.',
    sensors: { hr: true, power: false, source: 'samples' },
    flags: [{ code: 'HR_GAPS', metric: 12 }],
    flagsVersion: 1,
  };
  const reason = { reason: 'Причина действия' };
  const entryAction = { entryId: USER_ID, reason: 'Срезка маршрута' };

  it('мутации — POST с причиной на путях протокола; ответ — по схеме', async () => {
    const cases = [
      [
        (api: ReturnType<typeof createAdminApiClient>) =>
          api.excludeAttempt(USER_ID, USER_ID, reason),
        `${RACE}/attempts/${USER_ID}/exclude`,
        reason,
        attempt,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) =>
          api.restoreAttempt(USER_ID, USER_ID, reason),
        `${RACE}/attempts/${USER_ID}/restore`,
        reason,
        { ...attempt, status: 'queued', review: { ...attempt.review, kind: 'restored' } },
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) => api.recheckRaceResults(USER_ID, reason),
        `${RACE}/results/recheck`,
        reason,
        summary,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) => api.publishProtocol(USER_ID, reason),
        `${RACE}/protocol`,
        reason,
        summary,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) =>
          api.disqualifyResult(USER_ID, entryAction),
        `${RACE}/protocol/disqualify`,
        entryAction,
        summary,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) =>
          api.revokeDisqualification(USER_ID, entryAction),
        `${RACE}/protocol/revoke-disqualification`,
        entryAction,
        summary,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) => api.recheckProtocol(USER_ID, reason),
        `${RACE}/protocol/recheck`,
        reason,
        summary,
      ],
      [
        (api: ReturnType<typeof createAdminApiClient>) => api.applyProtocolRecheck(USER_ID, reason),
        `${RACE}/protocol/apply-recheck`,
        reason,
        summary,
      ],
    ] as const;
    for (const [run, url, body, response] of cases) {
      const client = admin(200, response);
      await expect(run(client.api)).resolves.toEqual(response);
      expect(client.calls[0]).toMatchObject({
        url,
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
    }
    const broken = admin(200, { ...summary, phase: 'archived' });
    await expect(broken.api.publishProtocol(USER_ID, reason)).rejects.toThrow();
  });

  it('чтения: участники и история пересчётов', async () => {
    const standings = admin(200, {
      source: 'live',
      revision: null,
      truncated: false,
      groupScheme: null,
      groups: [],
      items: [],
    });
    await standings.api.getRaceStandings(USER_ID);
    expect(standings.calls[0]).toMatchObject({ url: `${RACE}/standings`, method: 'GET' });

    const history = admin(200, { items: [] });
    await history.api.listProtocolRecalculations(USER_ID);
    expect(history.calls[0]).toMatchObject({
      url: `${RACE}/protocol/recalculations`,
      method: 'GET',
    });
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

describe('createAdminApiClient: сброс имени райдера (profile-02)', () => {
  it('POST name-reset: путь, тело, cookie панели, разбор ответа', async () => {
    const { calls, api } = admin(200, { reset: true });
    await expect(api.resetRiderName(USER_ID, { reason: 'Оскорбительное имя' })).resolves.toEqual({
      reset: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `/v1/admin/profiles/${USER_ID}/name-reset`,
      method: 'POST',
      credentials: 'same-origin',
      body: { reason: 'Оскорбительное имя' },
    });
  });

  it('ответ не по схеме — ошибка разбора', async () => {
    const { api } = admin(200, { ok: true });
    await expect(api.resetRiderName(USER_ID, { reason: 'Оскорбительное имя' })).rejects.toThrow();
  });
});

describe('createAdminApiClient: модерация профилей райдеров (profile-moderation)', () => {
  const TOKEN = 'a'.repeat(43);
  const detail = {
    userId: USER_ID,
    name: null,
    club: 'Velo',
    avatar: { id: TOKEN },
    isPublic: true,
    openReportCount: 1,
    lastReportAt: '2026-10-28T10:00:00.000Z',
    reportRevision: 1,
    reports: [],
  };

  it('listRiderProfiles — очередь с курсором и лимитом', async () => {
    const { calls, api } = admin(200, { items: [], nextCursor: null });
    await expect(api.listRiderProfiles({ cursor: 'c1', limit: 10 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(calls[0]).toMatchObject({
      url: '/v1/admin/rider-profiles?cursor=c1&limit=10',
      method: 'GET',
      credentials: 'same-origin',
    });
  });

  it('getRiderProfile — карточка; ответ не по схеме — ошибка', async () => {
    const one = admin(200, detail);
    await expect(one.api.getRiderProfile(USER_ID)).resolves.toEqual(detail);
    expect(one.calls[0]).toMatchObject({ url: `/v1/admin/rider-profiles/${USER_ID}` });
    const broken = admin(200, { ...detail, reports: [{ id: 'x' }] });
    await expect(broken.api.getRiderProfile(USER_ID)).rejects.toThrow();
  });

  it('сбросы фото и клуба, «Отклонить жалобы» — POST с телом и cookie панели', async () => {
    const avatar = admin(200, { reset: true });
    await expect(
      avatar.api.resetRiderAvatar(USER_ID, { reason: 'Неприличное фото' }),
    ).resolves.toEqual({ reset: true });
    expect(avatar.calls[0]).toMatchObject({
      url: `/v1/admin/rider-profiles/${USER_ID}/avatar-reset`,
      method: 'POST',
      credentials: 'same-origin',
      body: { reason: 'Неприличное фото' },
    });
    const club = admin(200, { reset: false });
    await expect(club.api.resetRiderClub(USER_ID, { reason: 'Мат в клубе' })).resolves.toEqual({
      reset: false,
    });
    expect(club.calls[0]).toMatchObject({
      url: `/v1/admin/rider-profiles/${USER_ID}/club-reset`,
      method: 'POST',
    });
    const dismiss = admin(200, { dismissed: true });
    await expect(
      dismiss.api.dismissRiderProfileReports(USER_ID, {
        reason: 'Всё в порядке',
        reportRevision: 2,
      }),
    ).resolves.toEqual({ dismissed: true });
    expect(dismiss.calls[0]).toMatchObject({
      url: `/v1/admin/rider-profiles/${USER_ID}/dismiss-reports`,
      method: 'POST',
      body: { reason: 'Всё в порядке', reportRevision: 2 },
    });
  });

  it('riderAvatarUrl — адрес фото без запроса', () => {
    const { calls, api } = admin(200, null);
    expect(api.riderAvatarUrl('a/b')).toBe('/v1/avatars/a%2Fb');
    expect(calls).toHaveLength(0);
  });
});

describe('createAdminApiClient: оформление приложения (app-themes)', () => {
  const appearance = {
    themeId: 'atlas',
    decor: 'none',
    version: 2,
    updatedAt: '2026-10-27T10:00:00.000Z',
  };

  it('GET appearance: путь, cookie панели, разбор PanelAppearance', async () => {
    const { calls, api } = admin(200, appearance);
    await expect(api.getAppearance()).resolves.toEqual(appearance);
    expect(calls[0]).toMatchObject({
      url: '/v1/admin/appearance',
      method: 'GET',
      credentials: 'same-origin',
    });
  });

  it('PUT appearance: метод, тело, cookie панели; ответ не по схеме — ошибка', async () => {
    const { calls, api } = admin(200, appearance);
    await expect(api.updateAppearance({ themeId: 'atlas', version: 1 })).resolves.toEqual(
      appearance,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/v1/admin/appearance',
      method: 'PUT',
      credentials: 'same-origin',
      body: { themeId: 'atlas', version: 1 },
    });
    const broken = admin(200, { ...appearance, themeId: 'neon' });
    await expect(broken.api.updateAppearance({ themeId: 'atlas', version: 1 })).rejects.toThrow();
  });
});
