import type { PlaywrightTestConfig } from '@playwright/test';

// Смоук панели «Протокол» (AC15): API и worker из apps/api/dist (`pnpm --filter @pokatim/api build`, миграции —
// `db:migrate`), панель — `vite preview` под /admin/ с прокси /v1 на этот API (тот же origin, как на стенде).
// Окружение API (MONGO_URL, REDIS_URL, SMTP_URL, MAIL_FROM, JWT_SECRET, EMAIL_TOKEN_SECRET, AGREEMENT_VERSION) —
// из процесса: переменные CI или явно в команде (docs/runbooks/local-dev.md, «Панель»).

type WebServer = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>[number];

/** Порт API смоука — свой, не dev-API (у него другие CORS и APP_LINK_BASE). */
export const API_PORT = Number(process.env.ADMIN_E2E_API_PORT ?? 3101);
export const API_URL = `http://127.0.0.1:${API_PORT}`;
/** Панель — `localhost`: браузер считает его безопасным контекстом, cookie `__Secure-` с `Secure` сохраняется. */
export const PREVIEW_PORT = Number(process.env.ADMIN_E2E_PORT ?? 4173);
export const ORIGIN = `http://localhost:${PREVIEW_PORT}`;
export const PANEL_URL = `${ORIGIN}/admin/`;

const api = {
  PORT: String(API_PORT),
  APP_LINK_BASE: 'pokatim://',
  CORS_ORIGINS: '',
};

/** Окружение процесса API — для CLI `grant-admin` из теста. */
export const apiEnv = { ...process.env, ...api } as Record<string, string>;

export const servers: WebServer[] = [
  {
    name: 'api',
    command: 'node dist/main.js',
    cwd: '../api',
    url: `${API_URL}/v1/health`,
    env: api,
    reuseExistingServer: false,
  },
  {
    // письма подтверждения отправляет worker (outbox → BullMQ → SMTP Mailpit)
    name: 'worker',
    command: 'node dist/worker.js',
    cwd: '../api',
    env: api,
  },
  {
    name: 'admin',
    command: `vite build && vite preview --port ${PREVIEW_PORT} --strictPort`,
    url: PANEL_URL,
    env: { ADMIN_BASE: '/admin/', ADMIN_API_URL: API_URL },
    reuseExistingServer: false,
    timeout: 120_000,
  },
];
