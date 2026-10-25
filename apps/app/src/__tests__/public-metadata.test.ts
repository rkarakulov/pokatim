/// <reference types="jest" />
import { generateMetadata as forgotMetadata } from '../app/(onboarding)/forgot-password';
import { generateMetadata as registerMetadata } from '../app/(onboarding)/register';
import { generateMetadata as signInMetadata } from '../app/(onboarding)/sign-in';
import { generateMetadata as resetMetadata } from '../app/auth/reset/[token]';
import { generateMetadata as verifyMetadata } from '../app/auth/verify/[token]';
import { generateMetadata as raceMetadata, loader as raceLoader } from '../app/races/[id]';
import { generateMetadata as seasonMetadata, loader as seasonLoader } from '../app/seasons/[id]';
import { resetPublicSsrCache } from '@/lib/public-ssr';

import { EMAIL, LINK_TOKEN } from './auth-fixtures';

jest.mock('@/lib/api');

const ORIGIN = 'https://pokatim.by';

afterEach(() => {
  delete process.env.WEB_ORIGIN;
});

// SSR web: мета публичных экранов в первых байтах HTML (превью ссылок), без персональных данных
describe('мета публичных экранов (generateMetadata)', () => {
  it('регистрация: заголовок, описание и OG; og:url — только из WEB_ORIGIN', async () => {
    expect(await registerMetadata(undefined, {})).toEqual({
      title: 'Регистрация — Покатим',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      openGraph: {
        title: 'Регистрация',
        description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
        type: 'website',
        siteName: 'Покатим',
      },
    });

    process.env.WEB_ORIGIN = `${ORIGIN}/`;
    expect(await registerMetadata(undefined, {})).toMatchObject({
      openGraph: { url: `${ORIGIN}/register` },
    });
  });

  it('вход: заголовок «Вход», OG без данных формы; og:url — только из WEB_ORIGIN', async () => {
    expect(await signInMetadata(undefined, {})).toEqual({
      title: 'Вход — Покатим',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      openGraph: {
        title: 'Вход',
        description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
        type: 'website',
        siteName: 'Покатим',
      },
    });

    process.env.WEB_ORIGIN = ORIGIN;
    expect(await signInMetadata(undefined, {})).toMatchObject({
      openGraph: { url: `${ORIGIN}/sign-in` },
    });
  });

  it('ссылка из письма: нейтральный заголовок, без e-mail и без og:url (в пути токен)', async () => {
    process.env.WEB_ORIGIN = ORIGIN;
    const meta = await verifyMetadata(undefined, { token: LINK_TOKEN });

    expect(meta).toMatchObject({
      title: 'Подтвердите e-mail — Покатим',
      openGraph: { title: 'Подтвердите e-mail', siteName: 'Покатим' },
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(LINK_TOKEN);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(ORIGIN);
  });

  it('«Восстановление пароля»: заголовок, OG без данных формы; og:url — только из WEB_ORIGIN', async () => {
    expect(await forgotMetadata(undefined, {})).toEqual({
      title: 'Восстановление пароля — Покатим',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      openGraph: {
        title: 'Восстановление пароля',
        description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
        type: 'website',
        siteName: 'Покатим',
      },
    });

    process.env.WEB_ORIGIN = ORIGIN;
    expect(await forgotMetadata(undefined, {})).toMatchObject({
      openGraph: { url: `${ORIGIN}/forgot-password` },
    });
  });

  it('ссылка сброса пароля: нейтральный заголовок, без e-mail, токена и og:url', async () => {
    process.env.WEB_ORIGIN = ORIGIN;
    const meta = await resetMetadata(undefined, { token: LINK_TOKEN });

    expect(meta).toMatchObject({
      title: 'Новый пароль — Покатим',
      openGraph: { title: 'Новый пароль', siteName: 'Покатим' },
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(LINK_TOKEN);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(ORIGIN);
  });
});

describe('мета публичной карточки гонки (SSR, R5)', () => {
  const ID = '0190a6f4-0000-7000-8000-000000000001';
  const race = {
    id: ID,
    title: 'Гравийный коридор Логойск',
    bikeClass: 'gravel',
    surfaces: ['gravel'],
    distanceKm: 62,
    windowStartsAt: '2026-10-03T21:00:00Z',
    windowEndsAt: '2026-10-12T20:59:00Z',
    protocolPlannedAt: '2026-10-14T09:00:00Z',
    phase: 'open',
    cancelReason: null,
    season: { id: ID, name: 'Сезон 2026' },
    description: 'Описание',
  };
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const respond = (status: number, body: unknown) =>
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );

  beforeEach(() => {
    resetPublicSsrCache();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.API_INTERNAL_URL = 'http://api.internal:3000';
  });
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.API_INTERNAL_URL;
  });

  it('поля гонки (название, даты с годом, класс, дистанция); og:url — WEB_ORIGIN + /races/<id>; один запрос на loader и мету', async () => {
    respond(200, race);
    process.env.WEB_ORIGIN = `${ORIGIN}/`;

    expect(await raceLoader(undefined, { id: ID })).toMatchObject({ id: ID, title: race.title });
    expect(await raceMetadata(undefined, { id: ID })).toEqual({
      title: 'Гравийный коридор Логойск — Покатим',
      description: '4–12 октября 2026 · Гравий · 62 км',
      openGraph: {
        title: 'Гравийный коридор Логойск',
        description: '4–12 октября 2026 · Гравий · 62 км',
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/races/${ID}`,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://api.internal:3000/v1/races/${ID}`);
  });

  it.each([
    ['404', () => respond(404, { code: 'NOT_FOUND', message: 'x' })],
    ['API недоступен', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
  ])('%s — нейтральная мета и noindex, без og:url', async (_name, setup) => {
    setup();
    process.env.WEB_ORIGIN = ORIGIN;
    const meta = await raceMetadata(undefined, { id: ID });

    expect(meta).toEqual({
      title: 'Гонка — Покатим',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      openGraph: {
        title: 'Гонка',
        description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
        type: 'website',
        siteName: 'Покатим',
      },
      robots: 'noindex',
    });
    expect(await raceLoader(undefined, { id: ID })).toBeNull();
  });

  it('невалидный id — без запроса во внутренний API', async () => {
    expect(await raceMetadata(undefined, { id: '../admin' })).toMatchObject({ robots: 'noindex' });
    expect(await raceLoader(undefined, { id: '../admin' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('мета публичного экрана сезона (SSR)', () => {
  const ID = '0190a6f4-0000-7000-8000-000000000026';
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();

  beforeEach(() => {
    resetPublicSsrCache();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.API_INTERNAL_URL = 'http://api.internal:3000';
  });
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.API_INTERNAL_URL;
  });

  it('название и даты с годом; og:url — WEB_ORIGIN + /seasons/<id>', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: ID,
            name: 'Сезон 2026',
            startsOn: '2026-04-01',
            endsOn: '2026-10-31',
            phase: 'current',
          }),
          { status: 200 },
        ),
      ),
    );
    process.env.WEB_ORIGIN = ORIGIN;

    expect(await seasonLoader(undefined, { id: ID })).toMatchObject({ name: 'Сезон 2026' });
    expect(await seasonMetadata(undefined, { id: ID })).toEqual({
      title: 'Сезон 2026 — Покатим',
      description: '1 апреля–31 октября 2026',
      openGraph: {
        title: 'Сезон 2026',
        description: '1 апреля–31 октября 2026',
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/seasons/${ID}`,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('не найден — нейтральная мета и noindex; невалидный id — без запроса', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 })),
    );
    expect(await seasonMetadata(undefined, { id: ID })).toMatchObject({
      title: 'Сезон — Покатим',
      robots: 'noindex',
    });
    fetchMock.mockClear();
    expect(await seasonMetadata(undefined, { id: 'current' })).toMatchObject({ robots: 'noindex' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
