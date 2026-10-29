// Web-сервер приложения: статика сборки (dist/client) + SSR и API-маршруты Expo (dist/server).
// Только Node: без алиасов `@/`, импорты с расширением — `node server/main.ts` (strip types) и jest.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import express, { type ErrorRequestHandler, type RequestHandler } from 'express';

/** Заголовки безопасности на каждом ответе (HTML, статика, API-маршруты); CSP — свой у ответа (nonce). */
export const securityHeaders: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/**
 * Внутренний заголовок запроса с nonce CSP для рендера (ADR-0025): expo-server передаёт `Request` в SSR, рендер React
 * (патч `@expo/router-server`) и `+html.tsx` (`cspNonce()`) берут nonce оттуда. Входящий от клиента — вырезается.
 * То же имя — в патче и `src/features/web-security/csp-nonce.ts` (сторож — web-server.test.ts).
 */
export const CSP_NONCE_HEADER = 'x-pokatim-csp-nonce';

/**
 * Origin-ы стиля, тайлов, глифов и спрайтов карт (`EXPO_PUBLIC_MAP_STYLE_*` сборки, ADR-0014): смена провайдера =
 * env сборки + эта строка (сторож — origin стиля из `deploy-dev.yml`).
 */
export const MAP_ORIGINS = ['https://tiles.openfreemap.org'] as const;

/**
 * CSP web приложения (ADR-0025). Скрипты — бандлы своего origin и inline-скрипты с nonce ответа (гидрация и данные
 * `loader`, тема, service worker); `'strict-dynamic'` не нужен — чанки `import()` тоже свои. Стили — `'unsafe-inline'`:
 * RN-web пишет `style`-атрибуты в SSR и `<style>` в рантайме. API — origin `EXPO_PUBLIC_API_URL` (dev-сборка и смоук —
 * другой порт; прод — тот же origin, `/v1`): запросы и картинки (аватары).
 */
export function contentSecurityPolicy(nonce: string, apiUrl: string | undefined): string {
  const api = apiUrl ? new URL(apiUrl).origin : undefined;
  const sources = (...items: (string | undefined)[]) => items.filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${sources("'self'", api, ...MAP_ORIGINS)}`,
    `img-src ${sources("'self'", 'data:', 'blob:', api)}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Nonce запроса в заголовок для рендера: expo-server читает `rawHeaders`, Express — `headers`. */
function passNonceToRender(req: express.Request, nonce: string) {
  const raw: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]!.toLowerCase() !== CSP_NONCE_HEADER) {
      raw.push(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
    }
  }
  raw.push(CSP_NONCE_HEADER, nonce);
  req.rawHeaders = raw;
  req.headers[CSP_NONCE_HEADER] = nonce;
}

/**
 * Пути с токеном в URL: ссылки из письма (`/auth/verify/<token>`, `/auth/reset/<token>`) и возврат из авторизации
 * устройства (`/devices/return?…&t=<тикет>`): без `Referer` даже к своему origin — запросы страницы к API (прод — тот
 * же origin) иначе несли бы полный URL с токеном. Билет (`/tickets/<код>`, event-tickets): код — запасной ключ входа
 * на мероприятие, в `Referer` внешним сайтам и API не уходит.
 */
const TOKEN_PATH_PREFIXES = ['/auth/', '/devices/return', '/tickets/'] as const;

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
  /** `EXPO_PUBLIC_API_URL`: origin API — в CSP (`connect-src`, `img-src`). */
  apiUrl: string | undefined;
}

export function createWebServer({ dist, render, apiUrl }: WebServerOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    // 128 бит на ответ: nonce повторяется только в кеше service worker (оболочка билета — вместе со своим заголовком)
    const nonce = randomBytes(16).toString('base64');
    passNonceToRender(req, nonce);
    res.set(securityHeaders);
    res.set('Content-Security-Policy', contentSecurityPolicy(nonce, apiUrl));
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
