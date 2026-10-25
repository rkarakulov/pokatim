import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, type APIRequestContext } from '@playwright/test';

import { verificationLink } from './mailpit';
import { apiProcessEnv } from './project';
import { API_URL } from './urls';

// Данные Главной для смоука с API (AC8 блока 02): сотрудник-админ публикует через API панели гонку и старт календаря
// в далёком году — ближайшие реальные даты dev-БД не засоряются, сезон этого года — один на все прогоны (не
// пересекается с настоящими и с годами смоука панели 3000–7999). После проверки гонка отменяется, старт снимается
// с публикации: в публичных списках прогоны не копятся. Запросы — из Node, без Origin/Sec-Fetch-Site (CSRF их
// пропускает, как native); cookie панели — из `set-cookie` ответа входа.

const API_DIR = resolve(__dirname, '../../api');
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

/** Публикует гонку и старт календаря `HOME_FIXTURE_YEAR` от имени сотрудника смоука. */
export async function publishHomeData(request: APIRequestContext): Promise<PublishedHomeData> {
  const run = Date.now();
  const year = HOME_FIXTURE_YEAR;
  const panel = await panelSession(request);

  // сезон года смоука: первый прогон создаёт, дальше — тот же
  const { items: seasons } = (await panel.get('/v1/admin/seasons')) as {
    items: { startsOn: string; endsOn: string }[];
  };
  const mid = `${year}-06-02`;
  if (!seasons.some(({ startsOn, endsOn }) => startsOn <= mid && mid <= endsOn)) {
    await panel.post(
      '/v1/admin/seasons',
      { name: `Сезон смоука Главной ${year}`, startsOn: `${year}-01-01`, endsOn: `${year}-12-31` },
      201,
    );
  }

  const raceTitle = `Коридор Главной ${run}`;
  const draft = (await panel.post(
    '/v1/admin/races',
    {
      title: raceTitle,
      bikeClass: 'gravel',
      surfaces: ['gravel'],
      distanceKm: 62,
      description: 'Смоук Главной.',
      windowStartsAt: `${year}-06-01T09:00:00Z`,
      windowEndsAt: `${year}-06-02T12:00:00Z`,
      protocolPlannedAt: `${year}-06-05T12:00:00Z`,
    },
    201,
  )) as Versioned;
  const race = (await panel.post(`/v1/admin/races/${draft.id}/publish`, {
    version: draft.version,
  })) as Versioned;

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
