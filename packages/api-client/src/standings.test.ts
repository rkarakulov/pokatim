import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-28T10:00:00.000Z';

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  cache: RequestCache | undefined;
  headers: Headers;
}

function stub(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      headers: new Headers(init?.headers),
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

const cell = { raceId: ID, place: 2, tied: true, outcome: 'placed', points: 85, counted: true };
const row = { order: 0, place: 1, tied: false, riderName: null, points: 85, cells: [cell] };
const table = {
  bikeClass: 'road',
  groupKey: 'm_u40',
  computedAt: AT,
  racesTotal: 1,
  racesCounted: 1,
  riders: 1,
  races: [{ id: ID, title: 'Г1', windowEndsAt: AT }],
  items: [row],
  nextCursor: null,
};
const summary = { seasonId: ID, computedAt: AT, tables: [] };

describe('приложение: рейтинг сезона (race-results-08)', () => {
  it('сводка и таблица — публично, без токена; id и курсор экранируются; незнакомый итог — unknown', async () => {
    const one = app(200, summary);
    await expect(one.api.getSeasonStandings('a/b')).resolves.toEqual(summary);
    const page = app(200, {
      ...table,
      items: [{ ...row, cells: [{ ...cell, outcome: 'dnf' }] }],
    });
    const body = await page.api.getSeasonStandingsTable(ID, {
      bikeClass: 'road',
      group: 'm_u40',
      cursor: 'c 1',
    });
    expect(body.items[0]!.cells[0]!.outcome).toBe('unknown');
    expect([one, page].map((client) => client.calls[0]?.url)).toEqual([
      'https://api.test/v1/seasons/a%2Fb/standings',
      `https://api.test/v1/seasons/${ID}/standings/table?bikeClass=road&group=m_u40&cursor=c+1`,
    ]);
    for (const client of [one, page]) {
      expect(client.calls[0]?.method).toBe('GET');
      expect(client.calls[0]?.headers.has('authorization')).toBe(false);
    }
  });

  it('таблица: по умолчанию — HTTP-кэш как обычно; fresh — в обход (`cache: no-cache`), URL тот же', async () => {
    const plain = app(200, table);
    await plain.api.getSeasonStandingsTable(ID, { bikeClass: 'road', group: 'm_u40' });
    const fresh = app(200, table);
    await fresh.api.getSeasonStandingsTable(
      ID,
      { bikeClass: 'road', group: 'm_u40' },
      { fresh: true },
    );
    expect(plain.calls[0]?.cache).toBeUndefined();
    expect(fresh.calls[0]?.cache).toBe('no-cache');
    expect(fresh.calls[0]?.url).toBe(plain.calls[0]?.url);
  });

  it('свои строки — с access-токеном', async () => {
    const mine = app(200, { seasonId: ID, computedAt: null, races: [], items: [] });
    await expect(mine.api.getMySeasonStandings('access', ID)).resolves.toEqual({
      seasonId: ID,
      computedAt: null,
      races: [],
      items: [],
    });
    expect(mine.calls[0]).toMatchObject({
      url: `https://api.test/v1/seasons/${ID}/standings/me`,
      method: 'GET',
    });
    expect(mine.calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });
});

describe('панель: рейтинг сезона', () => {
  it('сводка и таблица — пути, query, cookie панели, строгие схемы', async () => {
    const panelSummary = stub(200, { ...summary, formulaVersion: 1, sync: 'pending' });
    await expect(
      createAdminApiClient({ baseUrl: '', fetchImpl: panelSummary.fetchImpl }).getSeasonStandings(
        ID,
      ),
    ).resolves.toMatchObject({ sync: 'pending' });
    const panelTable = stub(200, { ...table, items: [{ ...row, userId: ID }] });
    await expect(
      createAdminApiClient({
        baseUrl: '',
        fetchImpl: panelTable.fetchImpl,
      }).getSeasonStandingsTable(ID, { bikeClass: 'gravel', group: 'overall', limit: 20 }),
    ).resolves.toMatchObject({ items: [{ userId: ID }] });
    expect(panelSummary.calls[0]).toMatchObject({
      url: `/v1/admin/seasons/${ID}/standings`,
      method: 'GET',
      credentials: 'same-origin',
    });
    expect(panelTable.calls[0]?.url).toBe(
      `/v1/admin/seasons/${ID}/standings/table?bikeClass=gravel&group=overall&limit=20`,
    );
    const broken = stub(200, { ...summary, formulaVersion: 1, sync: 'stale' });
    await expect(
      createAdminApiClient({ baseUrl: '', fetchImpl: broken.fetchImpl }).getSeasonStandings(ID),
    ).rejects.toBeTruthy();
  });
});
