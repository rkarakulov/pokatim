import type { PlaywrightTestConfig } from '@playwright/test';

import type { ExpectedResourceError } from './console-errors';
import { API_URL, BASE_URL, DEV_URL, WITH_API } from './urls';

// Расширение смоука web проектом. Файл создаёт шаблон, `copier update` его не перезаписывает (`_skip_if_exists`
// в copier.yml): проектное — здесь, playwright.config.ts, fixtures.ts и urls.ts остаются шаблонными.
// Окружение смоука (`E2E_API`, env серверов) проходит из процесса: `pnpm e2e:web` — turbo с `--env-mode=loose`.

type WebServer = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>[number];

/** pokatim: refresh web-сессии — аноним при каждой загрузке восстанавливает вход (без cookie → 401). */
export const REFRESH_URL = `${API_URL}/v1/auth/session/refresh`;
/** pokatim: вход по паролю (слайс 2); неверный пароль — 401 INVALID_CREDENTIALS, шаг смоука его проверяет. */
export const SIGN_IN_URL = `${API_URL}/v1/auth/session/sign-in`;
/** pokatim (блок 03): неизвестная гонка — карточка «Гонка не найдена», запрос из браузера получает 404. */
export const UNKNOWN_RACE_ID = '0190a6f4-0000-7000-8000-00000000dead';
/** pokatim (блок 04): неизвестный старт календаря — «Старт не найден», запрос из браузера получает 404. */
export const UNKNOWN_START_ID = '0190a6f4-0000-7000-8000-00000000beef';
/** pokatim (блок 05): неизвестный кофе-райд — «Райд не найден», запрос из браузера получает 404. */
export const UNKNOWN_RIDE_ID = '0190a6f4-0000-7000-8000-0000000c0ffe';
/** pokatim (routes-01): неизвестный маршрут каталога — «Маршрут недоступен», запрос из браузера получает 404. */
export const UNKNOWN_ROUTE_ID = '0190a6f4-0000-7000-8000-00000000a0a0';

// pokatim, E2E_API=1: API и worker из apps/api/dist (`pnpm --filter @pokatim/api build`), остальное окружение —
// apps/api/.env локально или переменные CI. Ссылки писем ведут на production-сборку смоука, её origin-ы —
// доверенные для CORS/CSRF (иначе POST с web — 403). Свой процесс, не dev-API: у него другие APP_LINK_BASE и CORS.
const api = {
  PORT: new URL(API_URL).port || '80',
  APP_LINK_BASE: `${BASE_URL}/`,
  CORS_ORIGINS: `${BASE_URL},${DEV_URL}`,
};

/** Окружение процесса API — для CLI панели (`grant-admin`) из смоука с данными (`schedule-fixture.ts`). */
export const apiProcessEnv: NodeJS.ProcessEnv = { ...process.env, ...api };

/** Серверы проекта, которые Playwright поднимает до web-серверов смоука. */
export const servers: WebServer[] = WITH_API
  ? [
      {
        name: 'api',
        command: 'node dist/main.js',
        cwd: '../api',
        url: `${API_URL}/v1/health`,
        env: api,
        reuseExistingServer: false,
      },
      {
        // письма регистрации отправляет worker (outbox → BullMQ → SMTP Mailpit); готовность — по письму в тесте
        name: 'worker',
        command: 'node dist/worker.js',
        cwd: '../api',
        env: api,
      },
    ]
  : [];

/** Окружение web-серверов смоука: с API — посев SSR публичных экранов (loader /status). */
export const webServerEnv: Record<string, string> = WITH_API ? { API_INTERNAL_URL: API_URL } : {};

/**
 * Ожидаемые отказы загрузки ресурсов в console.error production-сборки: 401 на восстановление сессии анонима
 * (task.md F5b §8.2), 401 входа с неверным паролем (шаг смоука слайса 2), 404 неизвестной гонки (шаг блока 03) и
 * неизвестного старта календаря (шаг блока 04) и
 * неизвестного кофе-райда (шаг блока 05) и неизвестного маршрута каталога (routes-01).
 * Всё остальное — падение.
 */
export const expectedResourceErrors: ExpectedResourceError[] = [
  { url: REFRESH_URL, status: 401 },
  { url: SIGN_IN_URL, status: 401 },
  { url: `${API_URL}/v1/races/${UNKNOWN_RACE_ID}`, status: 404 },
  { url: `${API_URL}/v1/calendar/${UNKNOWN_START_ID}`, status: 404 },
  { url: `${API_URL}/v1/rides/${UNKNOWN_RIDE_ID}`, status: 404 },
  { url: `${API_URL}/v1/routes/${UNKNOWN_ROUTE_ID}`, status: 404 },
];
