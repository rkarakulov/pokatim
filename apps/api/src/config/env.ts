import { existsSync } from 'node:fs';

import { defineCoreEnv, mailEnvShape } from '@rkarakulov/api-kit/core';
import { mongoEnvShape } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

const Secret = z.string().min(32, 'не короче 32 символов');
/**
 * Origin-ы, которым API разрешает запросы из браузера (CORS), через запятую: web в dev ходит с другого
 * порта (`expo start` — :8081, API — :3000). Пусто — CORS выключен: в проде web и API за одним origin
 * (обратный прокси). Только origin (схема, хост, порт) — без пути. Этим origin-ам разрешены credentials
 * (cookie сессии web) и они же — доверенные для CSRF-защиты (`http-app.ts`).
 */
const corsOrigins = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z.url().refine((origin) => new URL(origin).origin === origin, {
        message: 'CORS_ORIGINS: только origin (https://host[:port]), без пути и «/» в конце',
      }),
    ),
  );

/**
 * Окружение проекта: основа базы (процесс, Redis, TRUST_PROXY) + MongoDB (`MONGO_URL` с именем БД) + почта;
 * свои переменные — сюда.
 */
export const env = defineCoreEnv({
  ...mongoEnvShape,
  ...mailEnvShape,
  /** Подпись access JWT (HS256). */
  JWT_SECRET: Secret,
  /** Ключ HMAC для токенов ссылок в письмах: ссылку можно пересобрать по id строки, сырого токена нет нигде. */
  EMAIL_TOKEN_SECRET: Secret,
  /** База ссылок приложения: `pokatim://` в сборках, `exp://<host>:8081/--/` в Expo Go. */
  APP_LINK_BASE: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*:\/\/(.*\/)?$/i, 'схема://…/ — с завершающим слешем'),
  /** Версия соглашения и согласия на обработку данных, которую принимает пользователь при регистрации. */
  AGREEMENT_VERSION: z.string().min(1),
  CORS_ORIGINS: corsOrigins,
});
export type Env = ReturnType<typeof env.load>;

/**
 * Падаем на старте, если окружение невалидно — лучше, чем в рантайме.
 * Локально подхватываем apps/api/.env; уже заданные переменные (прод, CI) он не перекрывает.
 */
export const loadEnv = (source?: NodeJS.ProcessEnv): Env => env.load(source);

/** Только `MONGO_URL` — для `db:migrate`: отдельному шагу деплоя не нужны Redis и почта. `.env` — как у `loadEnv`. */
export function loadMongoUrl(source: NodeJS.ProcessEnv = process.env): string {
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');
  return z.object(mongoEnvShape).parse(source).MONGO_URL;
}
