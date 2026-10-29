import { describe, expect, it } from 'vitest';

import { createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

const PUBLIC_ID = 'a'.repeat(43);
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const item = {
  code: 'race_podium',
  object: { kind: 'race', id: ID, title: 'Гонка' },
  factDate: '2026-06-01',
};

function client(status: number, response?: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: init?.body,
    });
    return Promise.resolve(
      new Response(response === undefined ? null : JSON.stringify(response), { status }),
    );
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: достижения (achievements)', () => {
  it('listAchievements — GET с Bearer; незнакомый код — unknown', async () => {
    const own = { ...item, seen: false };
    const { calls, api } = client(200, { items: [own, { ...own, code: 'season_win' }] });
    await expect(api.listAchievements('access.jwt.x')).resolves.toEqual({
      items: [own, { ...own, code: 'unknown' }],
    });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/achievements',
        method: 'GET',
        authorization: 'Bearer access.jwt.x',
        body: undefined,
      },
    ]);
  });

  it('markAchievementsSeen — POST с телом и Bearer; 204 → undefined', async () => {
    const { calls, api } = client(204);
    await expect(
      api.markAchievementsSeen('access.jwt.x', ['race_podium', 'route_first']),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/achievements/seen',
        method: 'POST',
        authorization: 'Bearer access.jwt.x',
        body: JSON.stringify({ codes: ['race_podium', 'route_first'] }),
      },
    ]);
  });

  it('getRiderAchievements — публичный GET без токена', async () => {
    const { calls, api } = client(200, { items: [item] });
    await expect(api.getRiderAchievements(PUBLIC_ID)).resolves.toEqual({ items: [item] });
    expect(calls).toEqual([
      {
        url: `https://api.test/v1/riders/${PUBLIC_ID}/achievements`,
        method: 'GET',
        authorization: null,
        body: undefined,
      },
    ]);
  });
});
