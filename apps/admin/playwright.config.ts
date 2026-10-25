import { defineConfig } from '@playwright/test';

import { ORIGIN, servers } from './e2e/project';

// Смоук панели «Протокол» в браузере: `pnpm e2e:admin` (после `pnpm --filter @pokatim/api build` и `db:migrate`).
// Браузер — установленный Google Chrome; без него: PW_CHANNEL=chromium и `pnpm exec playwright install chromium`.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // один сценарий двух сотрудников — последовательно
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 120_000,
  use: { baseURL: ORIGIN, channel, trace: 'retain-on-failure', timezoneId: 'Europe/Minsk' },
  webServer: servers,
});
