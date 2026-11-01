import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const ID2 = '01890a5d-ac96-774b-bcce-b302099a8058';
const AT = '2026-10-27T10:00:00.000Z';

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
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const app = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return {
    calls,
    api: createApiClient({ baseUrl: 'https://api.test', fetchImpl, getAccessToken: () => 'jwt' }),
  };
};
const admin = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createAdminApiClient({ baseUrl: '', fetchImpl }) };
};

const myDispute = {
  id: ID,
  raceId: ID,
  targetEntryId: ID2,
  category: 'other',
  description: null,
  status: 'open',
  filedAt: AT,
  closedAt: null,
  decision: null,
};
const againstMe = {
  id: ID,
  raceId: ID,
  category: 'other',
  status: 'open',
  filedAt: AT,
  decidableBy: AT,
  response: { text: 'Мой трек', at: AT },
  canRespond: false,
  decision: null,
};
const listItem = {
  id: ID,
  race: { id: ID2, title: 'Гонка' },
  status: 'open',
  category: 'other',
  targetEntryId: ID,
  complainantEntryId: ID2,
  targetRiderName: null,
  filedAt: AT,
  decidableAt: AT,
  responded: false,
};
const panelDispute = {
  ...listItem,
  description: null,
  response: null,
  target: {
    entryId: ID,
    userId: ID2,
    resultStatus: 'provisional',
    place: 1,
    tied: false,
    elapsedSec: 3600,
    tier: 'verified',
    groupKey: 'w_u40',
    flags: [],
    riderName: null,
  },
  complainant: { entryId: ID2, userId: ID, riderName: null },
  decision: null,
  events: [],
  filingClosesAt: AT,
  protocolPlannedAt: AT,
  canDecide: true,
  decideBlockedBy: null,
};

describe('приложение: споры', () => {
  it('мои споры в гонке — Bearer, GET', async () => {
    const { calls, api } = app(200, {
      raceId: ID,
      filing: { status: 'open', closesAt: AT, protocolPlannedAt: AT, reason: null },
      filed: [],
      against: [],
    });
    await expect(api.getMyRaceDisputes('access', ID)).resolves.toMatchObject({
      filing: { status: 'open' },
    });
    expect(calls[0]).toMatchObject({
      url: `https://api.test/v1/races/${ID}/disputes`,
      method: 'GET',
    });
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });

  it('подача, отзыв, ответ — пути и тела', async () => {
    const filed = app(201, myDispute);
    await filed.api.fileDispute('access', ID, { targetEntryId: ID2, category: 'other' });
    await filed.api.withdrawDispute('access', ID);
    const responded = app(200, againstMe);
    await responded.api.respondToDispute('access', ID, { text: 'Мой трек' });
    expect(
      [...filed.calls, ...responded.calls].map(({ url, method, body, headers }) => [
        method,
        url,
        body,
        headers.get('authorization'),
      ]),
    ).toEqual([
      [
        'POST',
        `https://api.test/v1/races/${ID}/disputes`,
        { targetEntryId: ID2, category: 'other' },
        'Bearer access',
      ],
      ['POST', `https://api.test/v1/disputes/${ID}/withdraw`, {}, 'Bearer access'],
      [
        'POST',
        `https://api.test/v1/disputes/${ID}/response`,
        { text: 'Мой трек' },
        'Bearer access',
      ],
    ]);
  });
});

describe('панель: споры', () => {
  it('список, разбор, решение — пути, тела, cookie', async () => {
    const list = admin(200, { items: [listItem], nextCursor: null });
    await list.api.listDisputes({ status: 'open', raceId: ID2, cursor: 'c' });
    expect(list.calls[0]).toMatchObject({
      url: `/v1/admin/disputes?status=open&raceId=${ID2}&cursor=c`,
      method: 'GET',
      credentials: 'same-origin',
    });

    const { calls, api } = admin(200, panelDispute);
    await api.getDispute(ID);
    await api.decideDispute(ID, { outcome: 'rejected', template: 'track_confirmed', note: null });
    expect(calls.map(({ url, method, body }) => [method, url, body])).toEqual([
      ['GET', `/v1/admin/disputes/${ID}`, undefined],
      [
        'POST',
        `/v1/admin/disputes/${ID}/decision`,
        { outcome: 'rejected', template: 'track_confirmed', note: null },
      ],
    ]);
  });

  it('ряды пульса и мощности — GET …/series, ответ по схеме', async () => {
    const { calls, api } = admin(200, { state: 'preparing' });
    expect(await api.getDisputeSeries(ID)).toEqual({ state: 'preparing' });
    expect(calls[0]).toMatchObject({ url: `/v1/admin/disputes/${ID}/series`, method: 'GET' });
  });
});
