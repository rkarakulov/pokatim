import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type APIRequestContext } from '@playwright/test';

import { verificationLink } from './mailpit';
import { apiProcessEnv } from './project';
import { API_URL } from './urls';

// Данные расписания для смоука с API (Главная — AC8 блока 02, «Гонки и сезон» — блок 03): сотрудник-админ публикует
// через API панели гонки и старт календаря
// в далёком году — ближайшие реальные даты dev-БД не засоряются, сезон этого года — один на все прогоны (не
// пересекается с настоящими и с годами смоука панели 3000–7999). После проверки гонка отменяется, старт снимается
// с публикации: в публичных списках прогоны не копятся. Запросы — из Node, без Origin/Sec-Fetch-Site (CSRF их
// пропускает, как native); cookie панели — из `set-cookie` ответа входа.

const API_DIR = resolve(__dirname, '../../api');
/** Маршрут коридора (race-results-01) — синтетическая фикстура `packages/tracks`, GPX без времени ≈ 10,6 км. */
const ROUTE_GPX = resolve(
  __dirname,
  '../../../packages/tracks/src/__fixtures__/route-trk-no-time.gpx',
);
/** Год данных смоука Главной (`PLATFORM_MAX_YEAR` — 9998). */
export const HOME_FIXTURE_YEAR = 9001;
/** Сотрудник смоука — один на dev-БД: создаётся при первом прогоне, дальше переиспользуется. */
const ADMIN_EMAIL = 'home-e2e-admin@pokatim.test';
/** Пароль сотрудника и райдеров смоука. */
export const HOME_FIXTURE_PASSWORD = 'e2e-пароль-панели';

type PanelSignIn =
  { state: 'signedIn' } | { state: 'verificationRequired'; registrationToken: string };

const signIn = (request: APIRequestContext) =>
  request.post(`${API_URL}/v1/admin/session/sign-in`, {
    data: { email: ADMIN_EMAIL, password: HOME_FIXTURE_PASSWORD },
  });

/** Попытки входа считаются все (5 на e-mail+IP за 15 мин): частые локальные прогоны упираются в лимит. */
function expectNotLimited(status: number) {
  expect(
    status,
    'лимит входа сотрудника смоука: подождите 15 мин или снимите ключи rl:signin-* (runbook «Web»)',
  ).not.toBe(429);
}

async function confirmLatestLink(request: APIRequestContext, email: string) {
  const token = (await verificationLink(request, email)).split('/').pop();
  const confirmed = await request.post(`${API_URL}/v1/auth/verification/confirm`, {
    data: { token },
  });
  expect(confirmed.status()).toBe(200);
}

async function register(request: APIRequestContext, email: string) {
  const registered = await request.post(`${API_URL}/v1/auth/register`, {
    data: {
      email,
      password: HOME_FIXTURE_PASSWORD,
      birthDate: '1990-05-01',
      personalDataConsent: true,
    },
  });
  expect(registered.status()).toBe(201);
  await confirmLatestLink(request, email);
}

/** Райдер прогона (подтверждённый, опрос не пройден) — входит в приложение; вход сотрудника не тратится. */
export async function registerHomeRider(request: APIRequestContext): Promise<string> {
  const email = `home-rider-${Date.now()}@pokatim.test`;
  await register(request, email);
  return email;
}

/**
 * Сотрудник с ролью администратора: уже есть — вход; нет — регистрация и подтверждение (или повтор письма, если
 * прошлый прогон оборвался до подтверждения), затем `grant-admin` (идемпотентен).
 */
async function ensureAdmin(request: APIRequestContext) {
  const first = await signIn(request);
  expectNotLimited(first.status());
  if (first.status() === 200) {
    const body = (await first.json()) as PanelSignIn;
    if (body.state === 'signedIn') return first;
    await request.post(`${API_URL}/v1/auth/verification/resend`, {
      data: { registrationToken: body.registrationToken },
    });
    await confirmLatestLink(request, ADMIN_EMAIL);
  } else if (first.status() === 401) {
    await register(request, ADMIN_EMAIL);
  }
  // 403 — аккаунт есть, роли нет
  execFileSync(
    'node',
    ['dist/cli/panel.js', 'grant-admin', '--email', ADMIN_EMAIL, '--name', 'Смоук Главной'],
    { cwd: API_DIR, env: apiProcessEnv, encoding: 'utf8' },
  );
  const again = await signIn(request);
  expectNotLimited(again.status());
  expect(again.status()).toBe(200);
  return again;
}

/** Вход в панель: запросы с cookie сессии панели. */
async function panelSession(request: APIRequestContext) {
  const response = await ensureAdmin(request);
  const cookie = response
    .headersArray()
    .find(({ name }) => name.toLowerCase() === 'set-cookie')
    ?.value.split(';')[0];
  expect(cookie, 'cookie панели').toBeDefined();
  const headers = { cookie: cookie ?? '' };
  return {
    get: async (path: string) => {
      const res = await request.get(`${API_URL}${path}`, { headers });
      expect(res.status(), `GET ${path}`).toBe(200);
      return res.json();
    },
    post: async (path: string, data: unknown, status = 200) => {
      const res = await request.post(`${API_URL}${path}`, { headers, data });
      expect(res.status(), `POST ${path}: ${await res.text()}`).toBe(status);
      return res.json();
    },
    /** Маршрут из GPX: 202 — новый, 200 — тот же файл прошлого прогона; дальше — разбор worker до `ready`. */
    readyRoute: async (title: string): Promise<string> => {
      const res = await request.post(
        `${API_URL}/v1/admin/routes?title=${encodeURIComponent(title)}`,
        {
          headers: { ...headers, 'content-type': 'application/octet-stream' },
          data: readFileSync(ROUTE_GPX),
        },
      );
      expect([200, 202], `POST /v1/admin/routes: ${await res.text()}`).toContain(res.status());
      const { id } = (await res.json()) as { id: string };
      await expect
        .poll(
          async () => {
            const route = await request.get(`${API_URL}/v1/admin/routes/${id}`, { headers });
            return ((await route.json()) as { status: string }).status;
          },
          { timeout: 30_000, message: 'маршрут коридора разобран worker' },
        )
        .toBe('ready');
      return id;
    },
  };
}

export interface PublishedHomeData {
  raceTitle: string;
  startTitle: string;
  /** Отменить гонку и снять старт с публикации (данные остаются в панели и журнале). */
  withdraw: () => Promise<void>;
}

interface Versioned {
  id: string;
  version: number;
}

type Panel = Awaited<ReturnType<typeof panelSession>>;

/** Сезон года смоука: первый прогон создаёт, дальше — тот же (весь год `HOME_FIXTURE_YEAR`); id. */
async function ensureFixtureSeason(panel: Panel): Promise<string> {
  const year = HOME_FIXTURE_YEAR;
  const { items: seasons } = (await panel.get('/v1/admin/seasons')) as {
    items: { id: string; startsOn: string; endsOn: string }[];
  };
  const mid = `${year}-06-02`;
  const existing = seasons.find(({ startsOn, endsOn }) => startsOn <= mid && mid <= endsOn);
  if (existing) return existing.id;
  const created = (await panel.post(
    '/v1/admin/seasons',
    { name: `Сезон смоука Главной ${year}`, startsOn: `${year}-01-01`, endsOn: `${year}-12-31` },
    201,
  )) as Versioned;
  return created.id;
}

/** Опубликовать гонку года смоука (окно — по Минску тот же день, 12:00 UTC); id и версия. */
async function publishRace(
  panel: Panel,
  body: {
    title: string;
    bikeClass: string;
    startsAt: string;
    endsAt: string;
    protocolAt: string;
    /** Коридор: дистанцию считает сервер из длины маршрута. */
    corridor?: { routeId: string; widthM: number };
  },
): Promise<Versioned> {
  const draft = (await panel.post(
    '/v1/admin/races',
    {
      title: body.title,
      bikeClass: body.bikeClass,
      surfaces: ['gravel'],
      ...(body.corridor ? { corridor: body.corridor } : { distanceKm: 62 }),
      description: 'Смоук расписания.',
      windowStartsAt: body.startsAt,
      windowEndsAt: body.endsAt,
      protocolPlannedAt: body.protocolAt,
    },
    201,
  )) as Versioned;
  return (await panel.post(`/v1/admin/races/${draft.id}/publish`, {
    version: draft.version,
  })) as Versioned;
}

/** Публикует гонку и старт календаря `HOME_FIXTURE_YEAR` от имени сотрудника смоука. */
export async function publishHomeData(request: APIRequestContext): Promise<PublishedHomeData> {
  const run = Date.now();
  const year = HOME_FIXTURE_YEAR;
  const panel = await panelSession(request);
  await ensureFixtureSeason(panel);

  const raceTitle = `Коридор Главной ${run}`;
  const race = await publishRace(panel, {
    title: raceTitle,
    bikeClass: 'gravel',
    startsAt: `${year}-06-01T09:00:00Z`,
    endsAt: `${year}-06-02T12:00:00Z`,
    protocolAt: `${year}-06-05T12:00:00Z`,
  });

  const startTitle = `Старт Главной ${run}`;
  const start = (await panel.post(
    '/v1/admin/calendar',
    {
      title: startTitle,
      startsOn: `${year}-06-14`,
      endsOn: null,
      startTime: '09:00',
      discipline: 'road',
      city: 'Минск',
      place: '',
      distancesKm: [80, 120],
      registrationUrl: 'https://example.com/registration',
      description: '',
    },
    201,
  )) as Versioned;

  return {
    raceTitle,
    startTitle,
    withdraw: async () => {
      await panel.post(`/v1/admin/races/${race.id}/cancel`, {
        version: race.version,
        reason: 'organizational',
      });
      await panel.post(`/v1/admin/calendar/${start.id}/unpublish`, {
        version: start.version,
        reason: 'Смоук Главной: данные прогона снимаются после проверки.',
      });
    },
  };
}

export interface PublishedRaceData {
  seasonId: string;
  race: { id: string; title: string };
  /** С эталонным коридором ±50 м (race-results-01). */
  corridorRace: { id: string; title: string };
  cancelled: { id: string; title: string };
  /** Отменить опубликованную гонку прогона (отменённая остаётся в «Завершённых» — как в проде). */
  withdraw: () => Promise<void>;
}

/**
 * Данные блока 03 (Гонки и сезон): в сезоне года смоука — опубликованная гонка, вторая — сразу отменённая
 * («Неблагоприятные погодные условия»), третья — с эталонным коридором ±50 м по маршруту GPX (race-results-01: маршрут
 * загружается через API панели и разбирается worker). После проверки опубликованные тоже отменяются.
 */
export async function publishRaceData(request: APIRequestContext): Promise<PublishedRaceData> {
  const run = Date.now();
  const year = HOME_FIXTURE_YEAR;
  const panel = await panelSession(request);
  const seasonId = await ensureFixtureSeason(panel);

  const title = `Коридор гонок ${run}`;
  const race = await publishRace(panel, {
    title,
    bikeClass: 'gravel',
    startsAt: `${year}-07-01T09:00:00Z`,
    endsAt: `${year}-07-03T12:00:00Z`,
    protocolAt: `${year}-07-06T12:00:00Z`,
  });
  const cancelledTitle = `Отменённый коридор ${run}`;
  const toCancel = await publishRace(panel, {
    title: cancelledTitle,
    bikeClass: 'mtb',
    startsAt: `${year}-07-10T09:00:00Z`,
    endsAt: `${year}-07-11T12:00:00Z`,
    protocolAt: `${year}-07-14T12:00:00Z`,
  });
  await panel.post(`/v1/admin/races/${toCancel.id}/cancel`, {
    version: toCancel.version,
    reason: 'weather',
  });
  const corridorTitle = `Коридор с маршрутом ${run}`;
  const routeId = await panel.readyRoute('Маршрут смоука');
  const withCorridor = await publishRace(panel, {
    title: corridorTitle,
    bikeClass: 'road',
    startsAt: `${year}-07-20T09:00:00Z`,
    endsAt: `${year}-07-21T12:00:00Z`,
    protocolAt: `${year}-07-24T12:00:00Z`,
    corridor: { routeId, widthM: 50 },
  });

  return {
    seasonId,
    race: { id: race.id, title },
    corridorRace: { id: withCorridor.id, title: corridorTitle },
    cancelled: { id: toCancel.id, title: cancelledTitle },
    withdraw: async () => {
      for (const published of [race, withCorridor]) {
        await panel.post(`/v1/admin/races/${published.id}/cancel`, {
          version: published.version,
          reason: 'organizational',
        });
      }
    },
  };
}

export interface PublishedCatalogRoute {
  id: string;
  title: string;
  /** Снять с публикации (повтор безопасен — RC-2). */
  withdraw: () => Promise<void>;
}

/**
 * Маршрут каталога (routes-01): GPX смоука загружается через API панели (тот же файл — тот же маршрут), разбирается
 * worker и публикуется в каталог (Минск, асфальт). Название — с загрузки (RC-14).
 */
export async function publishCatalogRoute(
  request: APIRequestContext,
): Promise<PublishedCatalogRoute> {
  const panel = await panelSession(request);
  const id = await panel.readyRoute('Маршрут смоука');
  const route = (await panel.post(`/v1/admin/routes/${id}/publish`, {
    city: 'minsk',
    surfaces: ['asphalt'],
  })) as { id: string; title: string };
  return {
    id: route.id,
    title: route.title,
    withdraw: async () => {
      await panel.post(`/v1/admin/routes/${id}/unpublish`, {});
    },
  };
}

export interface PublishedCalendarData {
  /** Однодневный со ссылкой регистрации `https://example.com/registration`. */
  start: { id: string; title: string };
  /** Многодневный без ссылки регистрации. */
  multiDay: { id: string; title: string };
  /** Снять оба старта прогона с публикации. */
  withdraw: () => Promise<void>;
}

/**
 * Данные блока 04 (Календарь стартов): в июне года смоука — однодневный старт со ссылкой регистрации и
 * многодневный без неё; город «Смоук» — чипы реальных городов не засоряются. После проверки оба снимаются.
 */
export async function publishCalendarData(
  request: APIRequestContext,
): Promise<PublishedCalendarData> {
  const run = Date.now();
  const year = HOME_FIXTURE_YEAR;
  const panel = await panelSession(request);
  const create = async (body: Record<string, unknown>) =>
    (await panel.post(
      '/v1/admin/calendar',
      {
        endsOn: null,
        startTime: null,
        place: '',
        registrationUrl: null,
        description: '',
        city: 'Смоук',
        ...body,
      },
      201,
    )) as Versioned;

  const title = `Старт календаря ${run}`;
  const start = await create({
    title,
    startsOn: `${year}-06-20`,
    startTime: '08:00',
    discipline: 'road',
    place: 'Площадь смоука',
    distancesKm: [100, 60],
    registrationUrl: 'https://example.com/registration',
    description: 'Смоук календаря.',
  });
  const multiTitle = `Многодневка календаря ${run}`;
  const multiDay = await create({
    title: multiTitle,
    startsOn: `${year}-06-27`,
    endsOn: `${year}-06-28`,
    discipline: 'gravel',
    distancesKm: [120],
  });

  return {
    start: { id: start.id, title },
    multiDay: { id: multiDay.id, title: multiTitle },
    withdraw: async () => {
      for (const item of [start, multiDay]) {
        await panel.post(`/v1/admin/calendar/${item.id}/unpublish`, {
          version: item.version,
          reason: 'Смоук календаря: данные прогона снимаются после проверки.',
        });
      }
    },
  };
}
