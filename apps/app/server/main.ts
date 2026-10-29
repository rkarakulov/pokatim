// Production web-сервер: `pnpm build:web && pnpm start:web` (docs/runbooks/local-dev.md, «Web»).
// env: PORT, HOST, WEB_DIST (каталог сборки, по умолчанию dist; e2e — dist-dev); EXPO_PUBLIC_API_URL,
// API_INTERNAL_URL, WEB_ORIGIN — читает серверный бандл во время запроса.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import type * as ExpressAdapter from 'expo-server/adapter/express';

import { createWebServer } from './web-server.ts';

// ESM-сборка expo-server в Node не загружается (импорты без расширений) — адаптер берём через require
const require = createRequire(import.meta.url);
const { createRequestHandler } = require('expo-server/adapter/express') as typeof ExpressAdapter;

// серверный бандл не подставляет EXPO_PUBLIC_* при сборке, а читает из окружения процесса: без адреса API
// SSR экранов с данными отвечал бы 500 — падаем сразу и понятно
if (!process.env.EXPO_PUBLIC_API_URL) {
  throw new Error('EXPO_PUBLIC_API_URL не задан для web-сервера (apps/app/.env или окружение)');
}

const dist = resolve(import.meta.dirname, '..', process.env.WEB_DIST ?? 'dist');
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const app = createWebServer({
  dist,
  render: createRequestHandler({ build: join(dist, 'server') }),
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
});

app.listen(port, host, (error) => {
  if (error) throw error;
  process.stdout.write(`web: http://${host}:${port}\n`);
});
