import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
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

describe('приложение: участие в гонке и результаты', () => {
  it('таблица — публично, без токена, курсор и лимит в query', async () => {
    const results = app(200, {
      group: 'overall',
      status: 'provisional',
      ranked: 0,
      entries: 0,
      items: [],
      nextCursor: null,
    });
    await results.api.getRaceResults(ID, { limit: 2, cursor: 'c' });
    expect(results.calls[0]?.url).toBe(`https://api.test/v1/races/${ID}/results?limit=2&cursor=c`);
    expect(results.calls[0]?.method).toBe('GET');
    expect(results.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('моё участие и мутации — Bearer, пути и тела', async () => {
    const client = app(200, myEntry);
    await client.api.getMyRaceEntry('access', ID);
    await client.api.enterRace('access', ID);
    await client.api.withdrawFromRace('access', ID);
    await client.api.addRaceAttempt('access', ID, { uploadId: ID });
    expect(client.calls.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: `https://api.test/v1/races/${ID}/entry`, method: 'GET', body: undefined },
      { url: `https://api.test/v1/races/${ID}/entry`, method: 'POST', body: {} },
      { url: `https://api.test/v1/races/${ID}/entry/withdraw`, method: 'POST', body: {} },
      { url: `https://api.test/v1/races/${ID}/attempts`, method: 'POST', body: { uploadId: ID } },
    ]);
    for (const call of client.calls) {
      expect(call.headers.get('authorization')).toBe('Bearer access');
    }
    const candidates = app(200, { items: [] });
    await expect(candidates.api.listAttemptCandidates('access', ID)).resolves.toEqual({
      items: [],
    });
    expect(candidates.calls[0]?.url).toBe(`https://api.test/v1/races/${ID}/attempt-candidates`);
    expect(candidates.calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });

  it('свой трек попытки — путь, Bearer, валидация ответа (незнакомый marks — unknown)', async () => {
    const track = {
      attemptId: ID,
      line: [
        [27.5, 53.9],
        [27.6, 53.95],
      ],
      segment: { from: 0, to: 1 },
      offRuns: [],
      marks: 'later',
    };
    const client = app(200, track);
    await expect(client.api.getMyAttemptTrack('access', ID, ID)).resolves.toMatchObject({
      marks: 'unknown',
    });
    expect(client.calls[0]?.url).toBe(`https://api.test/v1/races/${ID}/entry/attempts/${ID}/track`);
    expect(client.calls[0]?.method).toBe('GET');
    expect(client.calls[0]?.headers.get('authorization')).toBe('Bearer access');
    const invalid = app(200, { ...track, line: [] });
    await expect(invalid.api.getMyAttemptTrack('access', ID, ID)).rejects.toBeDefined();
  });

  it('незнакомый статус результата — unknown; 409 — ApiHttpError', async () => {
    const future = app(200, { ...myEntry, result: { ...myEntry.result, status: 'appealed' } });
    await expect(future.api.getMyRaceEntry('access', ID)).resolves.toMatchObject({
      result: { status: 'unknown' },
    });
    const closed = app(409, { code: 'RACE_ENTRY_CLOSED', message: 'Приём заявок на гонку закрыт' });
    await expect(closed.api.enterRace('access', ID)).rejects.toMatchObject({ status: 409 });
  });
});

describe('панель: результаты гонки', () => {
  it('сводка и попытки — пути, фильтр статуса, cookie панели', async () => {
    const summary = stub(200, {
      raceId: ID,
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
      phase: 'closed',
      uploadClosesAt: '2026-10-27T21:00:00.000Z',
      protocol: null,
      recheck: null,
      publish: {
        canPublish: false,
        blockedBy: null,
        checklist: [
          { code: 'open_disputes', count: 0 },
          { code: 'unprocessed_tracks', count: 0 },
          { code: 'checks_queued', count: 0 },
          { code: 'checks_failed', count: 0 },
          { code: 'window_open', count: 1 },
        ],
      },
    });
    await createAdminApiClient({ baseUrl: '', fetchImpl: summary.fetchImpl }).getRaceResultsSummary(
      ID,
    );
    const attempts = stub(200, { items: [], nextCursor: null });
    await createAdminApiClient({ baseUrl: '', fetchImpl: attempts.fetchImpl }).listRaceAttempts(
      ID,
      {
        status: 'failed',
        limit: 10,
      },
    );
    expect(summary.calls[0]).toMatchObject({
      url: `/v1/admin/races/${ID}/results`,
      method: 'GET',
      credentials: 'same-origin',
    });
    expect(attempts.calls[0]?.url).toBe(`/v1/admin/races/${ID}/attempts?status=failed&limit=10`);
  });
});
