import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * CSP панели — из конфигурации nginx образа admin (infra/docker/admin-nginx.conf, один источник): `vite preview`
 * (e2e панели) отдаёт тот же заголовок, и смоук проверяет сборку под строгой политикой.
 */
function panelCsp(): string {
  const conf = readFileSync(
    new URL('../../infra/docker/admin-nginx.conf', import.meta.url),
    'utf8',
  );
  const csp = /set \$panel_csp "([^"]+)";/.exec(conf)?.[1];
  if (!csp) throw new Error('admin-nginx.conf: нет set $panel_csp');
  return csp;
}

// API, на который dev-сервер и `vite preview` (e2e админки) проксируют /v1 — панель ходит в API своим origin
const apiTarget = process.env.ADMIN_API_URL ?? 'http://localhost:3000';
const proxy = { '/v1': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  // путь панели на сайте: стенд и прод — /admin/ того же домена (ADMIN_BASE=/admin/, infra/docker/Dockerfile),
  // `pnpm dev` — корень dev-сервера; роутер берёт basepath из import.meta.env.BASE_URL
  base: process.env.ADMIN_BASE ?? '/',
  plugins: [react()],
  // берём исходники workspace-пакетов напрямую, без сборки
  resolve: {
    conditions: ['@pokatim/source', 'module', 'browser', 'development|production'],
  },
  // vitest работает в SSR-режиме — те же исходники пакетов
  ssr: {
    resolve: { conditions: ['@pokatim/source', 'module', 'node', 'development|production'] },
  },
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy,
    headers: {
      'Content-Security-Policy': panelCsp(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // время панели — Europe/Minsk (AGENTS.md §4.7): тесты не зависят от пояса машины
    env: { TZ: 'Europe/Minsk' },
  },
});
