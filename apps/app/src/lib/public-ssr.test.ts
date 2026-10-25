/// <reference types="jest" />
import { SeasonCard } from '@pokatim/contracts';

import { fetchPublicForSsr, publicPath, resetPublicSsrCache } from './public-ssr';

const ID = '0190a6f4-0000-7000-8000-000000000009';
const season = {
  id: ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
};

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  resetPublicSsrCache();
  jest.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') });
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.API_INTERNAL_URL = 'http://api.internal:3000/';
});
afterEach(() => {
  fetchMock.mockReset();
  jest.useRealTimers();
  delete process.env.API_INTERNAL_URL;
});

describe('publicPath', () => {
  it('id не Uuid — null (запроса не будет); Uuid — путь', () => {
    expect(publicPath('/v1/seasons', ID)).toBe(`/v1/seasons/${ID}`);
    expect(publicPath('/v1/seasons', ID, '/races')).toBe(`/v1/seasons/${ID}/races`);
    for (const bad of ['abc', '../admin', `${ID}/../x`, ['a'], undefined]) {
      expect(publicPath('/v1/races', bad)).toBeNull();
    }
  });
});

describe('fetchPublicForSsr (R5)', () => {
  it('200 — данные по схеме, внутренний адрес без двойного слэша; таймаут запроса задан', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toEqual(season);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.internal:3000/v1/seasons/${ID}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ['429', () => json(429, { code: 'RATE_LIMITED', message: 'x' })],
    ['500', () => json(500, { code: 'INTERNAL', message: 'x' })],
    ['битый JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['чужая форма', () => json(200, { id: 'x' })],
    ['сеть / таймаут', () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
  ])('%s — null, не кэшируется', async (_name, respond) => {
    fetchMock.mockImplementation(respond);
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toBeNull();
    fetchMock.mockImplementation(() => json(200, season));
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toEqual(season);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('нет API_INTERNAL_URL — null без запроса', async () => {
    delete process.env.API_INTERNAL_URL;
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('кэш: второй вызов (loader + generateMetadata) без запроса; 404 — тоже; истечение TTL — новый запрос', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard);
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toEqual(season);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(() => json(404, { code: 'NOT_FOUND', message: 'x' }));
    const missing = '/v1/seasons/0190a6f4-0000-7000-8000-000000000001';
    expect(await fetchPublicForSsr(missing, SeasonCard)).toBeNull();
    expect(await fetchPublicForSsr(missing, SeasonCard)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(59_999);
    await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    fetchMock.mockImplementation(() => json(200, { ...season, phase: 'finished' }));
    expect(await fetchPublicForSsr(`/v1/seasons/${ID}`, SeasonCard)).toMatchObject({
      phase: 'finished',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
