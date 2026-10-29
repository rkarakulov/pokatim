/// <reference types="jest" />
import { generateMetadata, loader } from '../app/routes/[id]';
import { resetPublicSsrCache } from '@/lib/public-ssr';

import {
  BRAND_ALT,
  BRAND_VERSION,
  OG_VERSION,
  ogImageMeta,
  pageCalls,
  respondWithOg,
} from './og-fetch';

jest.mock('@/lib/api');

const ORIGIN = 'https://pokatim.by';
const ID = '0190a6f4-0000-7000-8000-000000000001';
const route = {
  id: ID,
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 1_240,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-10-20T10:00:00.000Z',
};
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
const respond = (status: number, body: unknown, versions: Record<string, string> = {}) =>
  respondWithOg(fetchMock, status, body, versions);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/\u00a0/g, ' '));

const neutral = {
  title: 'Маршрут — Покатим',
  description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
  openGraph: {
    title: 'Маршрут',
    description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    type: 'website',
    siteName: 'Покатим',
  },
};

beforeEach(() => {
  resetPublicSsrCache();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.API_INTERNAL_URL = 'http://api.internal:3000';
});
afterEach(() => {
  fetchMock.mockReset();
  delete process.env.API_INTERNAL_URL;
  delete process.env.WEB_ORIGIN;
});

// SSR web: мета публичной карточки маршрута каталога в первых байтах HTML, без ПДн (routes-01, AC6)
describe('мета публичной карточки маршрута (SSR, routes-01)', () => {
  it('название, «N км · набор M м · петля · город»; og:url — WEB_ORIGIN + /routes/<id>; один запрос', async () => {
    respond(200, route);
    process.env.WEB_ORIGIN = `${ORIGIN}/`;
    expect(await loader(undefined, { id: ID })).toMatchObject({ id: ID, title: route.title });
    expect(plain(await generateMetadata(undefined, { id: ID }))).toEqual({
      title: 'Минское кольцо — Покатим',
      description: '86 км · набор 1 240 м · петля · Минск',
      openGraph: {
        title: 'Минское кольцо',
        description: '86 км · набор 1 240 м · петля · Минск',
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/routes/${ID}`,
      },
    });
    expect(pageCalls(fetchMock)).toEqual([`http://api.internal:3000/v1/routes/${ID}`]);
  });

  it('маршрут команды (author по умолчанию — старый API) — без robots', async () => {
    respond(200, { ...route, author: { kind: 'team' } });
    expect(await generateMetadata(undefined, { id: ID })).not.toHaveProperty('robots');
  });

  it('routes-06: маршрут райдера — noindex (RC-6); OG и описание без имени автора (U9)', async () => {
    respond(200, { ...route, author: { kind: 'rider', name: 'Аня К.' } });
    process.env.WEB_ORIGIN = ORIGIN;
    const metadata = plain(await generateMetadata(undefined, { id: ID }));
    expect(metadata).toEqual({
      title: 'Минское кольцо — Покатим',
      description: '86 км · набор 1 240 м · петля · Минск',
      openGraph: {
        title: 'Минское кольцо',
        description: '86 км · набор 1 240 м · петля · Минск',
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/routes/${ID}`,
      },
      robots: 'noindex',
    });
    expect(JSON.stringify(metadata)).not.toContain('Аня');
  });

  it('404 (снят, не опубликован) — нейтральная мета и noindex', async () => {
    respond(404, { code: 'NOT_FOUND', message: 'x' });
    expect(await generateMetadata(undefined, { id: ID })).toEqual({
      ...neutral,
      robots: 'noindex',
    });
    expect(await loader(undefined, { id: ID })).toBeNull();
  });

  it('API недоступен — нейтральная мета без robots', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await generateMetadata(undefined, { id: ID })).toEqual(neutral);
    expect(await loader(undefined, { id: ID })).toBeNull();
  });

  it('невалидный id — без запроса во внутренний API', async () => {
    expect(await generateMetadata(undefined, { id: '../admin' })).toMatchObject({
      robots: 'noindex',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('og-images (AC5): своя картинка маршрута от WEB_ORIGIN; нет версии — бренд; не найден — без картинки', async () => {
    process.env.WEB_ORIGIN = ORIGIN;
    respond(200, route, {
      [`/v1/og/cards/route/${ID}`]: OG_VERSION,
      '/v1/og/cards/brand/site': BRAND_VERSION,
    });
    expect(await generateMetadata(undefined, { id: ID })).toMatchObject({
      openGraph: ogImageMeta(
        `${ORIGIN}/v1/og/images/route/${ID}/${OG_VERSION}.png`,
        'Маршрут «Минское кольцо»',
      ),
      twitter: { card: 'summary_large_image' },
    });
    resetPublicSsrCache();
    respond(200, route, { '/v1/og/cards/brand/site': BRAND_VERSION });
    expect(await generateMetadata(undefined, { id: ID })).toMatchObject({
      openGraph: ogImageMeta(`${ORIGIN}/v1/og/images/brand/site/${BRAND_VERSION}.png`, BRAND_ALT),
    });
    resetPublicSsrCache();
    respond(404, { code: 'NOT_FOUND', message: 'x' }, { '/v1/og/cards/brand/site': BRAND_VERSION });
    expect(await generateMetadata(undefined, { id: ID })).not.toHaveProperty('openGraph.images');
  });
});
