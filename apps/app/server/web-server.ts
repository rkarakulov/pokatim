// Web-сервер приложения: статика сборки (dist/client) + SSR и API-маршруты Expo (dist/server).
// Только Node: без алиасов `@/`, импорты с расширением — `node server/main.ts` (strip types) и jest.
import { join } from 'node:path';

import express, { type ErrorRequestHandler, type RequestHandler } from 'express';

/** Заголовки безопасности на каждом ответе (HTML, статика, API-маршруты). */
export const securityHeaders: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // без script-src: гидрация и данные loader — inline-скрипты Expo
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

/**
 * Пути с токеном в URL: ссылки из письма (`/auth/verify/<token>`, `/auth/reset/<token>`) и возврат из авторизации
 * устройства (`/devices/return?…&t=<тикет>`): без `Referer` даже к своему origin — запросы страницы к API (прод — тот
 * же origin) иначе несли бы полный URL с токеном.
 */
const TOKEN_PATH_PREFIXES = ['/auth/', '/devices/return'] as const;

const isTokenPath = (path: string) =>
  TOKEN_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`),
  );

/** Хешированные бандлы Expo: имя меняется с содержимым — кешируются навсегда. */
const IMMUTABLE_PREFIX = '/_expo/static/';

export interface WebServerOptions {
  /** Каталог `expo export --platform web`: `client/` (статика) и `server/` (рендер). */
  dist: string;
  /** Обработчик Expo (`expo-server/adapter/express`) для всего, что не статика. */
  render: RequestHandler;
}

export function createWebServer({ dist, render }: WebServerOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set(securityHeaders);
    if (isTokenPath(req.path)) res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(
    express.static(join(dist, 'client'), {
      // `/` и маршруты — SSR, а не index.html; каталоги без редиректа на «/»
      index: false,
      redirect: false,
      setHeaders(res, _path) {
        const immutable = res.req.path.startsWith(IMMUTABLE_PREFIX);
        res.setHeader(
          'Cache-Control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  app.use(render);

  // ошибки — только статусом, без стека в ответе
  const onError: ErrorRequestHandler = (error: { status?: number }, _req, res, _next) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).end();
  };
  app.use(onError);

  return app;
}
