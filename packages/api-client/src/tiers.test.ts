import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

/* race-results-07: заявка с уровнем, таблица по группе, финишёры, анкета Verified, панель — пол и год анкеты. */

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-27T10:00:00.000Z';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

function stub(status: number, response: unknown) {
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
  return { calls, fetchImpl };
}

const app = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
};
const admin = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createAdminApiClient({ baseUrl: '', fetchImpl }) };
};

const myEntry = {
  raceId: ID,
  entry: null,
  result: {
    status: 'none',
    elapsedSec: null,
    place: null,
    tied: false,
    ranked: 0,
    group: 'overall',
  },
  attempts: [],
  pendingUploads: [],
  uploadClosesAt: AT,
  actions: { canEnter: true, canWithdraw: false, canAddAttempt: false, reasons: ['not_entered'] },
};

describe('приложение: уровни и группы', () => {
  it('enterRace — тело с уровнем и группой; без тела — {}', async () => {
    const client = app(201, myEntry);
    await client.api.enterRace('access', ID, { tier: 'verified', groupKey: 'm_40_49' });
    await client.api.enterRace('access', ID);
    expect(client.calls.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      {
        url: `https://api.test/v1/races/${ID}/entry`,
        method: 'POST',
        body: { tier: 'verified', groupKey: 'm_40_49' },
      },
      { url: `https://api.test/v1/races/${ID}/entry`, method: 'POST', body: {} },
    ]);
    expect(client.calls[0]?.authorization).toBe('Bearer access');
  });

  it('таблица по группе и финишёры — публично', async () => {
    const results = app(200, {
      group: 'm_u40',
      status: 'provisional',
      ranked: 0,
      entries: 0,
      items: [],
      nextCursor: null,
    });
    await expect(results.api.getRaceResults(ID, { group: 'm_u40' })).resolves.toMatchObject({
      groups: [],
      finishers: 0,
    });
    expect(results.calls[0]?.url).toBe(`https://api.test/v1/races/${ID}/results?group=m_u40`);
    const finishers = app(200, { total: 0, items: [], nextCursor: null });
    await finishers.api.getRaceFinishers(ID, { limit: 10, cursor: 'c' });
    expect(finishers.calls[0]).toMatchObject({
      url: `https://api.test/v1/races/${ID}/finishers?limit=10&cursor=c`,
      method: 'GET',
      authorization: null,
    });
  });

  it('анкета Verified — GET и PUT с Bearer', async () => {
    const view = { profile: null, demographicsLocked: false, suggestedBirthYear: 1990 };
    const client = app(200, view);
    await expect(client.api.getVerifiedProfile('access')).resolves.toEqual(view);
    const body = {
      gender: 'w' as const,
      birthYear: 1990,
      weightKg: 60,
      heightCm: 170,
      ftpW: null,
      consent: true as const,
    };
    await client.api.updateVerifiedProfile('access', body);
    expect(client.calls).toEqual([
      {
        url: 'https://api.test/v1/profile/verified',
        method: 'GET',
        authorization: 'Bearer access',
        body: undefined,
      },
      {
        url: 'https://api.test/v1/profile/verified',
        method: 'PUT',
        authorization: 'Bearer access',
        body,
      },
    ]);
  });
});

describe('панель: группы, флаги, пол и год анкеты', () => {
  it('участники — фильтры группы и «Требует внимания» в query', async () => {
    const client = admin(200, {
      source: 'live',
      revision: null,
      truncated: false,
      groupScheme: 'gender_age',
      groups: [],
      items: [],
    });
    await client.api.getRaceStandings(ID, { group: 'w_u40', attention: 'true' });
    await client.api.getRaceStandings(ID);
    expect(client.calls.map((call) => call.url)).toEqual([
      `/v1/admin/races/${ID}/standings?group=w_u40&attention=true`,
      `/v1/admin/races/${ID}/standings`,
    ]);
  });

  it('пол и год анкеты — GET и PATCH с причиной', async () => {
    const view = { gender: 'm', birthYear: 1980, demographicsLocked: true };
    const client = admin(200, { ...view, changed: true });
    await client.api.updateVerifiedDemographics(ID, { birthYear: 1981, reason: 'Ошибка ввода' });
    const read = admin(200, view);
    await expect(read.api.getVerifiedDemographics(ID)).resolves.toEqual(view);
    expect(client.calls[0]).toMatchObject({
      url: `/v1/admin/profiles/${ID}/verified-demographics`,
      method: 'PATCH',
      body: { birthYear: 1981, reason: 'Ошибка ввода' },
    });
    expect(read.calls[0]).toMatchObject({
      url: `/v1/admin/profiles/${ID}/verified-demographics`,
      method: 'GET',
    });
  });
});
