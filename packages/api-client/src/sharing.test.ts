import { describe, expect, it } from 'vitest';

import { createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';

function client(status: number, response: unknown) {
  const calls: { url: string; method?: string; headers: Headers }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, headers: new Headers(init?.headers) });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  const api = createApiClient({
    baseUrl: 'https://api.test',
    fetchImpl,
    getAccessToken: () => 'jwt',
  });
  return { api, calls };
}

describe('карточка для сторис', () => {
  it('статус — GET с шаблоном в query и токеном доступа', async () => {
    const { api, calls } = client(200, { status: 'ready', token: TOKEN });
    await expect(api.getStoryCard('jwt', ID, { template: 'night' })).resolves.toEqual({
      status: 'ready',
      token: TOKEN,
    });
    expect(calls[0]!.url).toBe(`https://api.test/v1/races/${ID}/entry/story-card?template=night`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer jwt');
  });

  it('ответ не по схеме (ready без токена) — ошибка', async () => {
    const { api } = client(200, { status: 'ready' });
    await expect(api.getStoryCard('jwt', ID, { template: 'line' })).rejects.toThrow();
  });

  it('адрес картинки — абсолютный, без запроса', () => {
    const { api, calls } = client(200, {});
    expect(api.storyCardImageUrl(TOKEN)).toBe(`https://api.test/v1/story-cards/${TOKEN}.png`);
    expect(calls).toEqual([]);
  });
});

describe('карточка-приглашение райда', () => {
  it('статус — GET приглашения с шаблоном и токеном доступа', async () => {
    const { api, calls } = client(200, { status: 'pending' });
    await expect(api.getRideInviteCard('jwt', ID, { template: 'line' })).resolves.toEqual({
      status: 'pending',
    });
    expect(calls[0]!.url).toBe(`https://api.test/v1/rides/${ID}/invite-card?template=line`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer jwt');
  });
});
