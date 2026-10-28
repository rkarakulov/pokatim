/// <reference types="jest" />
import { RiderPublicId, SeasonCard } from '@pokatim/contracts';

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

  it('схема токена (rider-profile): 43 символа base64url — путь; короче, длиннее и `../` — null', () => {
    const token = 'r'.repeat(43);
    expect(publicPath('/v1/riders', token, '', RiderPublicId)).toBe(`/v1/riders/${token}`);
    for (const bad of [token.slice(1), `${token}x`, '../x', ID]) {
      expect(publicPath('/v1/riders', bad, '', RiderPublicId)).toBeNull();
    }
  });
});

describe('fetchPublicForSsr (R5)', () => {
  const path = `/v1/seasons/${ID}`;

  it('200 — found с данными по схеме, внутренний адрес без двойного слэша; таймаут запроса задан', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'found', data: season });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.internal:3000/v1/seasons/${ID}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('404 — notFound', async () => {
    fetchMock.mockImplementation(() => json(404, { code: 'NOT_FOUND', message: 'x' }));
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'notFound' });
  });

  it.each([
    ['429', () => json(429, { code: 'RATE_LIMITED', message: 'x' })],
    ['500', () => json(500, { code: 'INTERNAL', message: 'x' })],
    ['битый JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['чужая форма', () => json(200, { id: 'x' })],
    ['сеть / таймаут', () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
  ])('%s — unavailable (не «не найдено»), не кэшируется', async (_name, respond) => {
    fetchMock.mockImplementation(respond);
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'unavailable' });
    fetchMock.mockImplementation(() => json(200, season));
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'found', data: season });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('нет API_INTERNAL_URL — unavailable без запроса', async () => {
    delete process.env.API_INTERNAL_URL;
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('кэш: второй вызов (loader + generateMetadata) без запроса; 404 — тоже; истечение TTL — новый запрос', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    await fetchPublicForSsr(path, SeasonCard);
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'found', data: season });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(() => json(404, { code: 'NOT_FOUND', message: 'x' }));
    const missing = '/v1/seasons/0190a6f4-0000-7000-8000-000000000001';
    expect(await fetchPublicForSsr(missing, SeasonCard)).toEqual({ status: 'notFound' });
    expect(await fetchPublicForSsr(missing, SeasonCard)).toEqual({ status: 'notFound' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(59_999);
    await fetchPublicForSsr(path, SeasonCard);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    fetchMock.mockImplementation(() => json(200, { ...season, phase: 'finished' }));
    expect(await fetchPublicForSsr(path, SeasonCard)).toMatchObject({
      status: 'found',
      data: { phase: 'finished' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cache: false — мимо кэша процесса: не читает и не кладёт (своё окно у вызывающего)', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    await fetchPublicForSsr(path, SeasonCard);
    await fetchPublicForSsr(path, SeasonCard, { cache: false });
    await fetchPublicForSsr('/v1/appearance-like', SeasonCard, { cache: false });
    await fetchPublicForSsr('/v1/appearance-like', SeasonCard, { cache: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('поток 404 по разным id (перебор ссылок) не вытесняет успешные ответы: отдельный пул отказов', async () => {
    fetchMock.mockImplementation(() => json(200, season));
    await fetchPublicForSsr(path, SeasonCard);
    fetchMock.mockImplementation(() => json(404, { code: 'NOT_FOUND', message: 'x' }));
    for (let i = 0; i < 1_000; i += 1) {
      await fetchPublicForSsr(
        `/v1/seasons/0190a6f4-0000-7000-8000-${String(i).padStart(12, '0')}`,
        SeasonCard,
      );
    }
    fetchMock.mockClear();
    expect(await fetchPublicForSsr(path, SeasonCard)).toEqual({ status: 'found', data: season });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
