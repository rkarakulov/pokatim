/// <reference types="jest" />
import {
  brandOgImage,
  brandOgImageFor,
  ogCardForSsr,
  ogCardIfOrigin,
  pageOgImage,
} from './og-image';
import { resetPublicSsrCache } from './public-ssr';

const ORIGIN = 'https://pokatim.by';
const API = 'http://api.internal:3000';
const ID = '0190a6f4-0000-7000-8000-000000000001';
const V = '0123456789abcdef';
const BRAND_V = 'fedcba9876543210';

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Ответы по URL: своя версия, бренд; остальное — 404. */
function routes(map: Record<string, () => Promise<Response>>) {
  fetchMock.mockImplementation((url) => (map[url] ?? (() => json(404, { code: 'NOT_FOUND' })))());
}

const page = { status: 'found' as const, data: { id: ID, title: 'Минское кольцо' } };

beforeEach(() => {
  resetPublicSsrCache();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.API_INTERNAL_URL = API;
  process.env.WEB_ORIGIN = `${ORIGIN}/`;
});
afterEach(() => {
  fetchMock.mockReset();
  delete process.env.API_INTERNAL_URL;
  delete process.env.WEB_ORIGIN;
});

describe('OG-картинка страницы (og-images, AC5)', () => {
  it('без WEB_ORIGIN — ни запросов, ни картинки', async () => {
    delete process.env.WEB_ORIGIN;
    expect(await ogCardIfOrigin('race', ID)).toBeNull();
    expect(await brandOgImage()).toBeUndefined();
    expect(await pageOgImage({ kind: 'race', page, card: null })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('невалидный id — без запроса', async () => {
    expect(await ogCardForSsr('race', '../admin')).toEqual({ status: 'notFound' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('страница и версия нашлись — своя картинка от WEB_ORIGIN с alt', async () => {
    routes({ [`${API}/v1/og/cards/race/${ID}`]: () => json(200, { version: V }) });
    const card = await ogCardIfOrigin('race', ID);
    expect(await pageOgImage({ kind: 'race', page, card })).toEqual({
      url: `${ORIGIN}/v1/og/images/race/${ID}/${V}.png`,
      alt: 'Гонка «Минское кольцо»',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('версии нет (404 или API недоступен) — бренд; бренд недоступен — без картинки', async () => {
    routes({ [`${API}/v1/og/cards/brand/site`]: () => json(200, { version: BRAND_V }) });
    const brand = {
      url: `${ORIGIN}/v1/og/images/brand/site/${BRAND_V}.png`,
      alt: 'Покатим — Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    };
    const card = await ogCardIfOrigin('ride', ID);
    expect(card).toEqual({ status: 'notFound' });
    expect(await pageOgImage({ kind: 'ride', page, card })).toEqual(brand);
    expect(
      await pageOgImage({
        kind: 'ride',
        page: { status: 'unavailable' },
        card: { status: 'unavailable' },
      }),
    ).toEqual(brand);

    resetPublicSsrCache();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(
      await pageOgImage({ kind: 'ride', page, card: { status: 'unavailable' } }),
    ).toBeUndefined();
  });

  it('страница «не найдено» — без картинки и без запроса бренда', async () => {
    expect(
      await pageOgImage({
        kind: 'race',
        page: { status: 'notFound' },
        card: { status: 'notFound' },
      }),
    ).toBeUndefined();
    expect(await brandOgImageFor({ status: 'notFound' })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('кэш 60 с: повторное чтение версии — без второго запроса', async () => {
    routes({ [`${API}/v1/og/cards/route/${ID}`]: () => json(200, { version: V }) });
    await ogCardForSsr('route', ID);
    await ogCardForSsr('route', ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
