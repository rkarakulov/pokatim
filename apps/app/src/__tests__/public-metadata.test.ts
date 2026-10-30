/// <reference types="jest" />
import { generateMetadata as notFoundMetadata } from '../app/+not-found';
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
import { generateMetadata as riderMetadata, loader as riderLoader } from '../app/riders/[id]';
import { generateMetadata as seasonMetadata, loader as seasonLoader } from '../app/seasons/[id]';
import { generateMetadata as homeMetadata } from '../app/(tabs)/index';
import { generateMetadata as statusMetadata } from '../app/status';
import { generateMetadata as welcomeMetadata, loader as welcomeLoader } from '../app/welcome';
import { resetPublicSsrCache } from '@/lib/public-ssr';

import { EMAIL, LINK_TOKEN } from './auth-fixtures';
import {
  BRAND_ALT,
  BRAND_VERSION,
  isOgUrl,
  OG_VERSION,
  ogImageMeta,
  ogResponse,
  pageCalls,
  respondWithOg,
} from './og-fetch';

jest.mock('@/lib/api');

const ORIGIN = 'https://pokatim.by';

afterEach(() => {
  delete process.env.WEB_ORIGIN;
});

// SSR web: мета публичных экранов в первых байтах HTML (превью ссылок), без персональных данных
describe('мета публичных экранов (generateMetadata)', () => {
  it('«Страница не найдена»: заголовок вкладки и noindex, без og:url (B1 смоука dev)', async () => {
    process.env.WEB_ORIGIN = ORIGIN;
    const meta = await notFoundMetadata(undefined, {});
    expect(meta).toMatchObject({ title: 'Страница не найдена — Покатим', robots: 'noindex' });
    expect(meta).not.toHaveProperty('openGraph.url');
  });

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
  const respond = (status: number, body: unknown) => respondWithOg(fetchMock, status, body);

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
    expect(pageCalls(fetchMock)).toEqual([`http://api.internal:3000/v1/races/${ID}`]);
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
    fetchMock.mockImplementation((url) =>
      isOgUrl(url)
        ? ogResponse(url, {})
        : Promise.resolve(
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
    expect(pageCalls(fetchMock)).toEqual([`http://api.internal:3000/v1/seasons/${ID}`]);
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
  const respond = (status: number, body: unknown) => respondWithOg(fetchMock, status, body);
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
    expect(pageCalls(fetchMock)).toEqual([`http://api.internal:3000/v1/calendar/${ID}`]);
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
  const respond = (status: number, body: unknown) => respondWithOg(fetchMock, status, body);
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
    expect(pageCalls(fetchMock)[0]).toBe(`http://api.internal:3000/v1/rides/${ID}`);
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

describe('мета публичного профиля райдера (SSR, rider-profile AC15)', () => {
  const PUBLIC_ID = 'r'.repeat(43);
  const rider = {
    publicId: PUBLIC_ID,
    name: 'Анна Ковальчук',
    club: 'Velo Club Minsk',
    avatar: { id: PUBLIC_ID },
    stats: { races: 4, podiums: 2, bestPlace: 1 },
  };
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const respond = (status: number, body: unknown) => respondWithOg(fetchMock, status, body);
  const neutral = {
    title: 'Профиль райдера — Покатим',
    description: 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле',
    openGraph: {
      title: 'Профиль райдера',
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

  it('найден — посев loader, но мета всегда нейтральная: noindex, без имени, клуба, фото и og:url (D-B2)', async () => {
    respondWithOg(fetchMock, 200, rider, { [`/v1/og/cards/rider/${PUBLIC_ID}`]: OG_VERSION });
    process.env.WEB_ORIGIN = ORIGIN;

    expect(await riderLoader(undefined, { id: PUBLIC_ID })).toMatchObject({ name: rider.name });
    expect(pageCalls(fetchMock)[0]).toBe(`http://api.internal:3000/v1/riders/${PUBLIC_ID}`);
    const meta = await riderMetadata(undefined, { id: PUBLIC_ID });
    const image = `${ORIGIN}/v1/og/images/rider/${PUBLIC_ID}/${OG_VERSION}.png`;
    expect(meta).toEqual({
      ...neutral,
      openGraph: {
        ...neutral.openGraph,
        ...ogImageMeta(image, 'Профиль райдера — Покатим'),
      },
      twitter: { card: 'summary_large_image' },
    });
    const text = JSON.stringify(meta);
    expect(text).not.toContain('Анна');
    expect(text).not.toContain('Velo');
    expect(meta).not.toHaveProperty('openGraph.url');
    // RC-1: publicId — только в URL картинки (не в title, description и og:url)
    expect(text.split(PUBLIC_ID)).toHaveLength(2);
    expect(text.replace(image, '')).not.toContain(PUBLIC_ID);
  });

  it('невалидный id — loader без запроса; 404 — null', async () => {
    expect(await riderLoader(undefined, { id: '../admin' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    respond(404, { code: 'NOT_FOUND', message: 'x' });
    expect(await riderLoader(undefined, { id: PUBLIC_ID })).toBeNull();
    expect(await riderMetadata(undefined, { id: PUBLIC_ID })).toEqual(neutral);
  });
});

describe('мета и посев гостевого лендинга /welcome (guest-landing, G6)', () => {
  const TAGLINE = 'Гонки, маршруты, кофе-райды и календарь стартов в одном профиле';
  const TITLE = 'Покатим — гонки, сезон, кофе-райды и маршруты';
  const BASE = 'http://api.internal:3000';
  const PATHS = {
    races: '/v1/races?scope=current&limit=1',
    season: '/v1/seasons/current',
    routes: '/v1/routes?author=team&limit=3',
    calendar: '/v1/calendar?limit=1',
  };
  const BODIES = {
    races: { items: [], nextCursor: null },
    season: { season: null },
    routes: { items: [], nextCursor: null },
    calendar: { items: [], nextCursor: null },
  };
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const respond = (failing: string | null = null) =>
    fetchMock.mockImplementation((url) => {
      const entry = Object.entries(PATHS).find(([, path]) => url === `${BASE}${path}`);
      if (!entry || entry[0] === failing) return Promise.reject(new TypeError('fetch failed'));
      const body = BODIES[entry[0] as keyof typeof BODIES];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });

  beforeEach(() => {
    resetPublicSsrCache();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.API_INTERNAL_URL = BASE;
  });
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.API_INTERNAL_URL;
  });

  it('<title> без повтора бренда, description — слоган, og:url — WEB_ORIGIN + /welcome, без robots (RC-2)', async () => {
    process.env.WEB_ORIGIN = `${ORIGIN}/`;
    const meta = await welcomeMetadata(undefined, {});
    expect(meta).toEqual({
      title: TITLE,
      description: TAGLINE,
      openGraph: {
        title: TITLE,
        description: TAGLINE,
        type: 'website',
        siteName: 'Покатим',
        url: `${ORIGIN}/welcome`,
      },
    });
    expect(meta).not.toHaveProperty('robots');
    // к API — только версия бренд-картинки (og-images); недоступна — без og:image
    expect(pageCalls(fetchMock)).toEqual([]);
  });

  it('мета корня `/` — мета лендинга (RC-3), без запросов к API кроме версии бренд-картинки', async () => {
    process.env.WEB_ORIGIN = ORIGIN;
    expect(await homeMetadata(undefined, {})).toEqual(await welcomeMetadata(undefined, {}));
    expect(pageCalls(fetchMock)).toEqual([]);
  });

  it('loader: четыре публичных списка с API_INTERNAL_URL (маршруты — только команды, RC-5)', async () => {
    respond();
    expect(await welcomeLoader(undefined, {})).toEqual(BODIES);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(
      Object.values(PATHS)
        .map((path) => `${BASE}${path}`)
        .sort(),
    );
  });

  it.each(Object.keys(PATHS))('loader: сбой части %s — `null` только у неё', async (failing) => {
    respond(failing);
    expect(await welcomeLoader(undefined, {})).toEqual({ ...BODIES, [failing]: null });
  });

  it('loader без API_INTERNAL_URL — все части `null`, без запросов и без исключения', async () => {
    delete process.env.API_INTERNAL_URL;
    expect(await welcomeLoader(undefined, {})).toEqual({
      races: null,
      season: null,
      routes: null,
      calendar: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OG-картинки публичных страниц (og-images, AC5)', () => {
  const API = 'http://api.internal:3000';
  const ID = '0190a6f4-0000-7000-8000-000000000061';
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const brand = ogImageMeta(`${ORIGIN}/v1/og/images/brand/site/${BRAND_VERSION}.png`, BRAND_ALT);
  const own = (kind: string, alt: string) =>
    ogImageMeta(`${ORIGIN}/v1/og/images/${kind}/${ID}/${OG_VERSION}.png`, alt);
  const versions = (kind: string) => ({
    [`/v1/og/cards/${kind}/${ID}`]: OG_VERSION,
    '/v1/og/cards/brand/site': BRAND_VERSION,
  });
  const brandOnly = { '/v1/og/cards/brand/site': BRAND_VERSION };

  const pages = {
    race: {
      metadata: raceMetadata,
      body: {
        id: ID,
        title: 'Минское кольцо',
        bikeClass: 'road',
        surfaces: ['asphalt'],
        distanceKm: 42,
        windowStartsAt: '2026-10-03T21:00:00Z',
        windowEndsAt: '2026-10-12T20:59:00Z',
        protocolPlannedAt: '2026-10-14T09:00:00Z',
        phase: 'open',
        cancelReason: null,
        season: null,
        description: null,
      },
      alt: 'Гонка «Минское кольцо»',
      path: `/v1/races/${ID}`,
    },
    ride: {
      metadata: rideMetadata,
      body: {
        id: ID,
        title: 'Минское кольцо',
        organizerName: null,
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
        description: null,
      },
      alt: 'Кофе-райд «Минское кольцо»',
      path: `/v1/rides/${ID}`,
    },
    calendar: {
      metadata: calendarMetadata,
      body: {
        id: ID,
        title: 'Минское кольцо',
        startsOn: '2027-06-14',
        endsOn: null,
        startTime: null,
        discipline: 'road',
        city: 'Минск',
        distancesKm: [100],
        registrationUrl: null,
        phase: 'upcoming',
        place: null,
        description: null,
      },
      alt: 'Старт «Минское кольцо»',
      path: `/v1/calendar/${ID}`,
    },
  } as const;

  beforeEach(() => {
    resetPublicSsrCache();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.API_INTERNAL_URL = API;
    process.env.WEB_ORIGIN = `${ORIGIN}/`;
  });
  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.API_INTERNAL_URL;
  });

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    '%s: своя картинка 1200×630 от WEB_ORIGIN, twitter:card; версия — параллельно с данными страницы',
    async (kind) => {
      const page = pages[kind];
      respondWithOg(fetchMock, 200, page.body, versions(kind));
      const meta = await page.metadata(undefined, { id: ID });
      expect(meta).toMatchObject({
        openGraph: own(kind, page.alt),
        twitter: { card: 'summary_large_image' },
      });
      expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(
        [`${API}/v1/og/cards/${kind}/${ID}`, `${API}${page.path}`].sort(),
      );
    },
  );

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    '%s: картинки нет (отменён) — бренд; страница не найдена — без og:image',
    async (kind) => {
      const page = pages[kind];
      respondWithOg(fetchMock, 200, page.body, brandOnly);
      expect(await page.metadata(undefined, { id: ID })).toMatchObject({ openGraph: brand });
      resetPublicSsrCache();
      respondWithOg(fetchMock, 404, { code: 'NOT_FOUND', message: 'x' }, versions(kind));
      const missing = await page.metadata(undefined, { id: ID });
      expect(missing).not.toHaveProperty('openGraph.images');
      expect(missing).not.toHaveProperty('twitter');
    },
  );

  it('сезон: своя картинка с alt названия; версии нет — бренд; не найден — без картинки', async () => {
    const season = {
      id: ID,
      name: 'Сезон 2026',
      startsOn: '2026-04-01',
      endsOn: '2026-10-31',
      phase: 'current',
    };
    respondWithOg(fetchMock, 200, season, versions('season'));
    expect(await seasonMetadata(undefined, { id: ID })).toMatchObject({
      openGraph: { ...own('season', 'Сезон «Сезон 2026»'), url: `${ORIGIN}/seasons/${ID}` },
      twitter: { card: 'summary_large_image' },
    });
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(
      [`${API}/v1/og/cards/season/${ID}`, `${API}/v1/seasons/${ID}`].sort(),
    );
    resetPublicSsrCache();
    respondWithOg(fetchMock, 200, season, brandOnly);
    expect(await seasonMetadata(undefined, { id: ID })).toMatchObject({ openGraph: brand });
    resetPublicSsrCache();
    respondWithOg(fetchMock, 404, { code: 'NOT_FOUND', message: 'x' }, versions('season'));
    const missing = await seasonMetadata(undefined, { id: ID });
    expect(missing).toMatchObject({ robots: 'noindex' });
    expect(missing).not.toHaveProperty('openGraph.images');
  });

  it('райдер: своя картинка без ПДн в alt; версии нет — бренд; не найден — без картинки; всегда noindex без og:url', async () => {
    const PUBLIC_ID = 'p'.repeat(43);
    const profile = {
      publicId: PUBLIC_ID,
      name: 'Анна Ковальчук',
      club: 'Velo Club Minsk',
      avatar: null,
      stats: { races: 4, podiums: 2, bestPlace: 1, finishes: 4 },
    };
    const card = { [`/v1/og/cards/rider/${PUBLIC_ID}`]: OG_VERSION, ...brandOnly };
    respondWithOg(fetchMock, 200, profile, card);
    const meta = await riderMetadata(undefined, { id: PUBLIC_ID });
    expect(meta).toMatchObject({
      openGraph: ogImageMeta(
        `${ORIGIN}/v1/og/images/rider/${PUBLIC_ID}/${OG_VERSION}.png`,
        'Профиль райдера — Покатим',
      ),
      robots: 'noindex',
    });
    expect(meta).not.toHaveProperty('openGraph.url');
    expect(JSON.stringify(meta)).not.toMatch(/Анна|Velo/);

    resetPublicSsrCache();
    respondWithOg(fetchMock, 200, profile, brandOnly);
    expect(await riderMetadata(undefined, { id: PUBLIC_ID })).toMatchObject({
      openGraph: brand,
      robots: 'noindex',
    });
    resetPublicSsrCache();
    respondWithOg(fetchMock, 404, { code: 'NOT_FOUND', message: 'x' }, card);
    expect(await riderMetadata(undefined, { id: PUBLIC_ID })).not.toHaveProperty(
      'openGraph.images',
    );
    // невалидный publicId — без запросов (ни страницы, ни версии)
    fetchMock.mockClear();
    expect(await riderMetadata(undefined, { id: '../x' })).not.toHaveProperty('openGraph.images');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('API недоступен — бренд, если доступна его версия', async () => {
    fetchMock.mockImplementation((url) =>
      url.endsWith('/v1/og/cards/brand/site')
        ? ogResponse(url, brandOnly)
        : Promise.reject(new TypeError('fetch failed')),
    );
    expect(await raceMetadata(undefined, { id: ID })).toMatchObject({ openGraph: brand });
  });

  it('страницы-бренды: /welcome, /, вход, регистрация, /status', async () => {
    fetchMock.mockImplementation((url) =>
      isOgUrl(url)
        ? ogResponse(url, brandOnly)
        : Promise.resolve(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 })),
    );
    for (const meta of [
      await welcomeMetadata(undefined, {}),
      await homeMetadata(undefined, {}),
      await signInMetadata(undefined, {}),
      await registerMetadata(undefined, {}),
      await statusMetadata(undefined, {}),
    ]) {
      expect(meta).toMatchObject({ openGraph: brand, twitter: { card: 'summary_large_image' } });
    }
  });

  it('без WEB_ORIGIN — ни картинки, ни OG-запросов', async () => {
    delete process.env.WEB_ORIGIN;
    respondWithOg(fetchMock, 200, pages.race.body, versions('race'));
    expect(await raceMetadata(undefined, { id: ID })).not.toHaveProperty('openGraph.images');
    expect(await signInMetadata(undefined, {})).not.toHaveProperty('openGraph.images');
    expect(fetchMock.mock.calls.filter(([url]) => isOgUrl(url))).toEqual([]);
  });
});
