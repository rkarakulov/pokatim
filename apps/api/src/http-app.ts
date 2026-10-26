import { API_VERSION } from '@pokatim/contracts';
import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { configureHttpApp } from '@rkarakulov/api-kit/core';

import type { Env } from './config/env';

/**
 * HTTP-конфигурация pokatim поверх базы до `app.init()` — одна для `main.ts`, теста `http-app.test.ts` и стенда
 * int-тестов (`test/harness.ts`, `configureApp`):
 * - CORS с credentials — только для `CORS_ORIGINS` (методы GET/HEAD/POST/PUT, заголовок `Authorization`) (dev: web на другом порту того же хоста шлёт cookie
 *   сессии); пусто — CORS выключен (прод: web и API за одним origin);
 * - CSRF — Fetch Metadata (`Sec-Fetch-Site`) с fallback `Origin`/`Host` глобально: небезопасный запрос
 *   с чужого сайта → 403, native без этих заголовков проходит. Доверены только те же `CORS_ORIGINS`.
 * - `application/octet-stream` — сырой поток для загрузки заездов (лимит — в обработчике).
 * Вне production пустой `CORS_ORIGINS` — предупреждение в лог: web в dev (другой порт) без него не ходит в API.
 */
export function configureHttp(
  app: NestFastifyApplication,
  env: Pick<Env, 'CORS_ORIGINS' | 'NODE_ENV'>,
): NestFastifyApplication {
  configureHttpApp(app, { prefix: API_VERSION });
  if (env.CORS_ORIGINS.length > 0) {
    // методы — явно: по умолчанию @fastify/cors разрешает только GET/HEAD/POST, а профиль пишется PUT (онбординг)
    // и PATCH (имя и согласие); заголовки не задаются — отражаются запрошенные (Authorization авторизованных эндпоинтов)
    app.enableCors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH'],
    });
  } else if (env.NODE_ENV !== 'production') {
    new Logger('Http').warn(
      'CORS_ORIGINS пуст: браузер с другого origin (web в dev) не получит ответы API — задайте origin-ы web (apps/api/.env.example)',
    );
  }
  app.enableCsrfProtection({ trustedOrigins: env.CORS_ORIGINS });
  // загрузка заезда (tracks-devices, R3): `application/octet-stream` — сырой поток без чтения и без общего
  // `bodyLimit` 64 КБ; обработчик читает его сам после гарда, с обрывом на лимите файла (`track-uploads.controller`)
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload);
    });
  return app;
}
