import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, type APIRequestContext } from '@playwright/test';

import { verificationLink } from './mailpit';
import { apiProcessEnv } from './project';
import { API_URL } from './urls';

// Данные Главной для смоука с API (AC8 блока 02): сотрудник-админ (CLI `grant-admin`) через API панели публикует
// гонку с открытым в будущем окном (сезон — существующий или однодневный) и старт календаря. Запросы — из Node, без
// Origin/Sec-Fetch-Site (CSRF их пропускает, как native); cookie панели — из `set-cookie` ответа входа.

const API_DIR = resolve(__dirname, '../../api');
/** Пароль сотрудника смоука — им же он входит в приложение. */
export const HOME_FIXTURE_PASSWORD = 'e2e-пароль-панели';
const PASSWORD = HOME_FIXTURE_PASSWORD;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Момент UTC с точностью до минуты (`UtcMinute` контракта). */
const utcMinute = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}:00Z`;
/**
 * Календарная дата момента 12:00 UTC: в Минске (UTC+3) это тот же день — дата сезона и окна совпадает без перевода
 * пояса в смоуке.
 */
const noonUtc = (ms: number) => `${new Date(ms).toISOString().slice(0, 10)}T12:00:00Z`;

async function verifiedUser(request: APIRequestContext, email: string) {
  const registered = await request.post(`${API_URL}/v1/auth/register`, {
    data: { email, password: PASSWORD, birthDate: '1990-05-01', personalDataConsent: true },
  });
  expect(registered.status()).toBe(201);
  const token = (await verificationLink(request, email)).split('/').pop();
  const confirmed = await request.post(`${API_URL}/v1/auth/verification/confirm`, {
    data: { token },
  });
  expect(confirmed.status()).toBe(200);
}

/** Вход в панель: cookie сессии панели для следующих запросов. */
async function panelSession(request: APIRequestContext, email: string) {
  const response = await request.post(`${API_URL}/v1/admin/session/sign-in`, {
    data: { email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
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
  /** E-mail сотрудника (подтверждён, опрос не пройден). */
  email: string;
  raceTitle: string;
  startTitle: string;
}

/** Публикует гонку и старт календаря от имени нового админа панели. */
export async function publishHomeData(request: APIRequestContext): Promise<PublishedHomeData> {
  const run = Date.now();
  const email = `home-admin-${run}@pokatim.test`;
  await verifiedUser(request, email);
  execFileSync('node', ['dist/cli/panel.js', 'grant-admin', '--email', email, '--name', 'Ольга'], {
    cwd: API_DIR,
    env: apiProcessEnv,
    encoding: 'utf8',
  });
  const panel = await panelSession(request, email);

  // окно: с ближайшего часа до полудня UTC через 2 дня — гонка «предстоящая», в выдаче `scope=current`
  const windowStartsAt = utcMinute(Math.ceil((run + HOUR) / HOUR) * HOUR);
  const windowEndsAt = noonUtc(run + 2 * DAY);
  const endDate = windowEndsAt.slice(0, 10);

  // сезон по концу окна: существующий или однодневный (другой его не покрывает — пересечения нет)
  const { items: seasons } = (await panel.get('/v1/admin/seasons')) as {
    items: { startsOn: string; endsOn: string }[];
  };
  if (!seasons.some(({ startsOn, endsOn }) => startsOn <= endDate && endDate <= endsOn)) {
    await panel.post(
      '/v1/admin/seasons',
      { name: `Сезон e2e ${run}`, startsOn: endDate, endsOn: endDate },
      201,
    );
  }

  const raceTitle = `Коридор Главной ${run}`;
  const race = (await panel.post(
    '/v1/admin/races',
    {
      title: raceTitle,
      bikeClass: 'gravel',
      surfaces: ['gravel'],
      distanceKm: 62,
      description: 'Смоук Главной.',
      windowStartsAt,
      windowEndsAt,
      protocolPlannedAt: utcMinute(Date.parse(windowEndsAt) + 3 * DAY),
    },
    201,
  )) as { id: string; version: number };
  await panel.post(`/v1/admin/races/${race.id}/publish`, { version: race.version });

  const startTitle = `Старт Главной ${run}`;
  await panel.post(
    '/v1/admin/calendar',
    {
      title: startTitle,
      // +10 дней по UTC — в будущем и по Минску
      startsOn: new Date(run + 10 * DAY).toISOString().slice(0, 10),
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
  );
  return { email, raceTitle, startTitle };
}
