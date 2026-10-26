/// <reference types="jest" />
import { generateMetadata as forgotMetadata } from '../app/(onboarding)/forgot-password';
import { generateMetadata as registerMetadata } from '../app/(onboarding)/register';
import { generateMetadata as signInMetadata } from '../app/(onboarding)/sign-in';
import { generateMetadata as resetMetadata } from '../app/auth/reset/[token]';
import { generateMetadata as verifyMetadata } from '../app/auth/verify/[token]';
import {
  generateMetadata as calendarMetadata,
  loader as calendarLoader,
} from '../app/calendar/[id]';
import { generateMetadata as raceMetadata, loader as raceLoader } from '../app/races/[id]';
import { generateMetadata as rideMetadata, loader as rideLoader } from '../app/rides/[id]';
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

  const neutral = {
    title: 'Гонка — Покатим',
    description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    openGraph: {
      title: 'Гонка',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      type: 'website',
      siteName: 'Покатим',
    },
  };

  it.each([
    ['API недоступен', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
    ['429', () => respond(429, { code: 'RATE_LIMITED', message: 'x' })],
  ])(
    '%s — нейтральная мета без robots: гонка есть, превью не должно её «удалить» из индекса',
    async (_name, setup) => {
      setup();
      process.env.WEB_ORIGIN = ORIGIN;
      expect(await raceMetadata(undefined, { id: ID })).toEqual(neutral);
      expect(await raceLoader(undefined, { id: ID })).toBeNull();
    },
  );

  it('404 — нейтральная мета и noindex, без og:url', async () => {
    respond(404, { code: 'NOT_FOUND', message: 'x' });
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

  it('API недоступен — нейтральная мета без robots', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const meta = await seasonMetadata(undefined, { id: ID });
    expect(meta).toMatchObject({ title: 'Сезон — Покатим' });
    expect(meta).not.toHaveProperty('robots');
  });
});

describe('мета публичной карточки старта (SSR, блок 04)', () => {
  const ID = '0190a6f4-0000-7000-8000-000000000041';
  const start = {
    id: ID,
    title: 'Минская сотка',
    startsOn: '2027-06-14',
    endsOn: null,
    startTime: '08:00',
    discipline: 'road',
    city: 'Минск',
    distancesKm: [100],
    registrationUrl: 'https://example.by/registration',
    phase: 'upcoming',
    place: 'площадь Независимости',
    description: 'Описание',
  };
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const respond = (status: number, body: unknown) =>
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );
  const neutral = {
    title: 'Старт календаря — Покатим',
    description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    openGraph: {
      title: 'Старт календаря',
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
  });

  it('поля старта (дата с годом, дисциплина, город, дистанции); og:url — WEB_ORIGIN + /calendar/<id>', async () => {
    respond(200, start);
    process.env.WEB_ORIGIN = ORIGIN;

    expect(await calendarLoader(undefined, { id: ID })).toMatchObject({
      id: ID,
      phase: 'upcoming',
    });
    expect(await calendarMetadata(undefined, { id: ID })).toEqual({
      title: 'Минская сотка — Покатим',
      description: '14 июня 2027 · Шоссе · Минск · 100 км',
      openGraph: {
        title: 'Минская сотка',
        description: '14 июня 2027 · Шоссе · Минск · 100 км',
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/calendar/${ID}`,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://api.internal:3000/v1/calendar/${ID}`);
  });

  it('404 — нейтральная мета и noindex; невалидный id — без запроса', async () => {
    respond(404, { code: 'NOT_FOUND', message: 'x' });
    expect(await calendarMetadata(undefined, { id: ID })).toEqual({
      ...neutral,
      robots: 'noindex',
    });
    expect(await calendarLoader(undefined, { id: ID })).toBeNull();
    fetchMock.mockClear();
    expect(await calendarMetadata(undefined, { id: 'months' })).toMatchObject({
      robots: 'noindex',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('API недоступен — нейтральная мета без robots', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await calendarMetadata(undefined, { id: ID })).toEqual(neutral);
    expect(await calendarLoader(undefined, { id: ID })).toBeNull();
  });
});

describe('мета публичной карточки кофе-райда (SSR, блок 05)', () => {
  const ID = '0190a6f4-0000-7000-8000-000000000051';
  const ride = {
    id: ID,
    title: 'Кофе-райд на Минское море',
    organizerName: 'Катя Л.',
    startsAt: '2026-10-04T07:00:00Z',
    city: 'minsk',
    place: 'Парк Победы',
    distanceKm: 42,
    paceMinKmh: 22,
    paceMaxKmh: 24,
    limit: 12,
    goingCount: 5,
    full: false,
    phase: 'upcoming',
    cancelReason: null,
    rescheduledAt: null,
    description: 'Секретное описание',
  };
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const respond = (status: number, body: unknown) =>
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );
  const neutral = {
    title: 'Кофе-райд — Покатим',
    description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    openGraph: {
      title: 'Кофе-райд',
      description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
      type: 'website',
      siteName: 'Покатим',
    },
    robots: 'noindex',
  };

  beforeEach(() => {
    resetPublicSsrCache();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.API_INTERNAL_URL = 'http://api.internal:3000';
  });
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.API_INTERNAL_URL;
  });

  it('дата с годом, город, км, темп; og:url — WEB_ORIGIN + /rides/<id>; всегда noindex; без описания и организатора', async () => {
    respond(200, ride);
    process.env.WEB_ORIGIN = ORIGIN;

    expect(await rideLoader(undefined, { id: ID })).toMatchObject({ id: ID });
    const description = 'Воскресенье, 4 октября 2026, 10:00 · Минск · 42 км · темп 22–24 км/ч';
    const meta = await rideMetadata(undefined, { id: ID });
    expect(meta).toEqual({
      title: 'Кофе-райд на Минское море — Покатим',
      description,
      openGraph: {
        title: 'Кофе-райд на Минское море',
        description,
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/rides/${ID}`,
      },
      robots: 'noindex',
    });
    const text = JSON.stringify(meta);
    expect(text).not.toContain('Секретное');
    expect(text).not.toContain('Катя');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://api.internal:3000/v1/rides/${ID}`);
  });

  it('404, невалидный id (без запроса) и API недоступен — нейтральная мета с noindex', async () => {
    respond(404, { code: 'NOT_FOUND', message: 'x' });
    expect(await rideMetadata(undefined, { id: ID })).toEqual(neutral);
    expect(await rideLoader(undefined, { id: ID })).toBeNull();
    fetchMock.mockReset();
    expect(await rideMetadata(undefined, { id: 'new' })).toEqual(neutral);
    expect(fetchMock).not.toHaveBeenCalled();
    resetPublicSsrCache();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await rideMetadata(undefined, { id: ID })).toEqual(neutral);
  });
});
