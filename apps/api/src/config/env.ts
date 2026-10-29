import { createECDH } from 'node:crypto';
import { existsSync } from 'node:fs';

import { DEVICE_PROVIDERS } from '@pokatim/contracts';
import { defineCoreEnv, type EnvDefinition, mailEnvShape } from '@rkarakulov/api-kit/core';
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

/** Список через запятую (пробелы вокруг элементов отбрасываются, пустые — тоже). */
const commaList = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
const flag = (fallback: boolean) => z.stringbool().default(fallback);
/** Необязательная переменная: пустое значение в `.env` (`OW_API_KEY=`) — как не заданная. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const GiB = 1024 ** 3;

/**
 * Треки и устройства (tracks-devices, ADR-0011): хранилище исходников заездов и агрегатор устройств Open Wearables.
 * Ключи OW — только env (R13); провайдеры выключены по умолчанию (`DEVICES_ENABLED=false`) — стенд стартует без них.
 */
const tracksDevicesEnvShape = {
  /** Каталог исходников заездов (том `trackfiles` на dev; S3 — до прода). */
  TRACK_STORAGE_DIR: z.string().min(1).default('var/trackfiles'),
  /** Квота: сумма размеров хранимых исходников (Q10). */
  TRACK_STORAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(2 * GiB),
  /** Минимум свободного места тома: меньше — новые файлы не принимаются (общий диск dev). */
  TRACK_STORAGE_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(GiB),
  DEVICES_ENABLED: flag(false),
  DEVICES_AGGREGATOR: z.enum(['open_wearables']).default('open_wearables'),
  /** Провайдеры экрана — пересечение с живым списком агрегатора. */
  DEVICE_PROVIDERS_ALLOWLIST: commaList('garmin,wahoo').pipe(z.array(z.enum(DEVICE_PROVIDERS))),
  /**
   * Куда разрешено вернуть пользователя после авторизации (точный префикс `returnUrl`): web
   * `https://<хост>/devices/return`, сборки `pokatim://devices/return`, Expo Go `exp://…` — только вне production.
   */
  DEVICE_RETURN_URLS: commaList().pipe(
    z.array(z.string().regex(/^(https?|pokatim|exp):\/\/\S+$/, 'DEVICE_RETURN_URLS: URL возврата')),
  ),
  /** Публичный origin API для `redirect_uri` агрегатора (`<origin>/v1/devices/callback`). */
  PUBLIC_API_ORIGIN: optional(
    z.url().refine((origin) => new URL(origin).origin === origin, {
      message: 'PUBLIC_API_ORIGIN: только origin, без пути',
    }),
  ),
  DEVICES_SYNC_INTERVAL_MIN: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(15),
  DEVICES_HISTORY_DAYS: z.coerce.number().int().min(0).max(90).default(30),
  OW_API_URL: optional(z.url({ protocol: /^https?$/ })),
  OW_API_KEY: optional(z.string().min(16)),
  /** Секрет Svix (`whsec_…`): не задан — вебхук отвечает 404, работает только pull (N1). */
  OW_WEBHOOK_SECRET: optional(
    z.string().regex(/^whsec_[A-Za-z0-9+/=]{16,}$/, 'OW_WEBHOOK_SECRET: whsec_<base64>'),
  ),
  OW_EXTERNAL_ID_PREFIX: z
    .string()
    .regex(/^[a-z0-9_-]{1,20}:$/)
    .default('pokatim:'),
  /** Общий инстанс OW с соседним сервисом (dev): в production запрещён. */
  OW_SHARED_INSTANCE: flag(false),
  /**
   * Стенд: dev-сервер тоже работает с `NODE_ENV=production` (сборка, производительность), поэтому запреты «только не в
   * проде» (общий OW, `exp://`) проверяются по паре `NODE_ENV=production` и `DEPLOY_STAGE=prod`. Умолчание — `prod`:
   * dev-стенд объявляет себя явно (compose).
   */
  DEPLOY_STAGE: z.enum(['dev', 'prod']).default('prod'),
};

/** Адрес Expo Push API по умолчанию — единственный разрешённый в production (ADR-0017). */
export const EXPO_PUSH_API_DEFAULT_URL = 'https://exp.host/--/api/v2/push';

/**
 * Уведомления (ADR-0017): push через Expo Push Service. Выключен по умолчанию (`PUSH_ENABLED=false` — push помечается
 * `skipped`, центр работает). Ключ Expo — только env, необязательный. Адрес меняют только тесты (фейк-сервер) и
 * dev-стенд; в production — только `exp.host`.
 */
const notificationsEnvShape = {
  PUSH_ENABLED: flag(false),
  EXPO_ACCESS_TOKEN: optional(z.string().min(20, 'EXPO_ACCESS_TOKEN: не короче 20 символов')),
  EXPO_PUSH_API_URL: z.url({ protocol: /^https?$/ }).default(EXPO_PUSH_API_DEFAULT_URL),
  /**
   * Web Push в PWA (ADR-0021) — второй транспорт канала push, независимый от `PUSH_ENABLED` (Expo). Нужны ключи VAPID:
   * публичный — несжатая точка P-256 (65 байт), приватный — 32 байта, оба base64url; `VAPID_SUBJECT` — `mailto:` или
   * `https:` (контакт для push-сервисов). Приватный — только env сервера.
   */
  WEB_PUSH_ENABLED: flag(false),
  VAPID_PUBLIC_KEY: optional(
    z.string().regex(/^B[A-Za-z0-9_-]{86}$/, 'VAPID_PUBLIC_KEY: base64url 65 байт (точка P-256)'),
  ),
  VAPID_PRIVATE_KEY: optional(
    z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'VAPID_PRIVATE_KEY: base64url 32 байта'),
  ),
  VAPID_SUBJECT: optional(
    z.string().regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'VAPID_SUBJECT: mailto: или https:'),
  ),
  /** Только тесты (`NODE_ENV=test`): origin фейкового push-сервиса вне белого списка хостов. */
  WEB_PUSH_TEST_ORIGIN: optional(z.url({ protocol: /^http$/ })),
};

/** Ключи VAPID, если Web Push включён и настроен (проверено на старте), иначе `null`. */
export function webPushVapid(
  value: Pick<Env, 'WEB_PUSH_ENABLED' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
): { publicKey: string; privateKey: string; subject: string } | null {
  const { WEB_PUSH_ENABLED, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = value;
  if (!WEB_PUSH_ENABLED || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
  return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT };
}

/** Канал push включён: хоть один транспорт — Expo (`PUSH_ENABLED`) или Web Push (ADR-0021). */
export function pushChannelEnabled(
  value: Pick<
    Env,
    'PUSH_ENABLED' | 'WEB_PUSH_ENABLED' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'
  >,
): boolean {
  return value.PUSH_ENABLED || webPushVapid(value) !== null;
}

/** Публичный ключ, выведенный из приватного (несжатая точка, base64url); битый ключ — `null`. */
function vapidPublicOf(privateKey: string): string | null {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey().toString('base64url');
  } catch {
    return null;
  }
}

const baseEnv = defineCoreEnv({
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
  /** Адрес поддержки для писем («Если это были не вы — напишите на …»); не задан — строки в письме нет. */
  SUPPORT_EMAIL: optional(z.email()),
  CORS_ORIGINS: corsOrigins,
  ...tracksDevicesEnvShape,
  ...notificationsEnvShape,
});
type BaseEnv = ReturnType<typeof baseEnv.load>;

/**
 * Зависимости переменных (проверка на старте, §8.3 п. 5): включённые устройства без адреса и ключа OW, без
 * `PUBLIC_API_ORIGIN` и `DEVICE_RETURN_URLS`; общий инстанс OW, `exp://` или чужой адрес Expo Push в production (не
 * dev-стенд) — отказ запуска.
 */
export function envDependencyErrors(value: BaseEnv): string[] {
  const errors: string[] = [];
  const production = value.NODE_ENV === 'production' && value.DEPLOY_STAGE === 'prod';
  if (value.DEVICES_ENABLED) {
    if (!value.OW_API_URL || !value.OW_API_KEY) {
      errors.push('DEVICES_ENABLED=true: нужны OW_API_URL и OW_API_KEY');
    }
    if (!value.PUBLIC_API_ORIGIN) errors.push('DEVICES_ENABLED=true: нужен PUBLIC_API_ORIGIN');
    if (value.DEVICE_RETURN_URLS.length === 0) {
      errors.push('DEVICES_ENABLED=true: нужен DEVICE_RETURN_URLS');
    }
  }
  if (production && value.OW_SHARED_INSTANCE) {
    errors.push('OW_SHARED_INSTANCE=true запрещён в production (ADR-0011)');
  }
  if (production && value.DEVICE_RETURN_URLS.some((url) => url.startsWith('exp://'))) {
    errors.push('DEVICE_RETURN_URLS: exp:// запрещён в production');
  }
  if (production && value.EXPO_PUSH_API_URL !== EXPO_PUSH_API_DEFAULT_URL) {
    errors.push(`EXPO_PUSH_API_URL: в production только ${EXPO_PUSH_API_DEFAULT_URL}`);
  }
  if (value.WEB_PUSH_ENABLED) {
    if (!value.VAPID_PUBLIC_KEY || !value.VAPID_PRIVATE_KEY || !value.VAPID_SUBJECT) {
      errors.push(
        'WEB_PUSH_ENABLED=true: нужны VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY и VAPID_SUBJECT',
      );
    } else if (vapidPublicOf(value.VAPID_PRIVATE_KEY) !== value.VAPID_PUBLIC_KEY) {
      errors.push('VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY — не пара');
    }
  }
  if (value.WEB_PUSH_TEST_ORIGIN && value.NODE_ENV !== 'test') {
    errors.push('WEB_PUSH_TEST_ORIGIN — только NODE_ENV=test');
  }
  return errors;
}

/**
 * Окружение проекта: основа базы (процесс, Redis, TRUST_PROXY) + MongoDB (`MONGO_URL` с именем БД) + почта + треки и
 * устройства; свои переменные — сюда. Зависимости переменных — `envDependencyErrors` поверх схемы.
 */
export const env: EnvDefinition<BaseEnv> = {
  schema: baseEnv.schema,
  load(source?: NodeJS.ProcessEnv) {
    const value = baseEnv.load(source);
    const errors = envDependencyErrors(value);
    if (errors.length > 0) throw new Error(`Окружение невалидно: ${errors.join('; ')}`);
    return value;
  },
};
export type Env = BaseEnv;

/**
 * Падаем на старте, если окружение невалидно — лучше, чем в рантайме.
 * Локально подхватываем apps/api/.env; уже заданные переменные (прод, CI) он не перекрывает.
 */
export const loadEnv = (source?: NodeJS.ProcessEnv): Env => env.load(source);

/**
 * Окружение CLI панели (`dist/cli/panel.js`): только MongoDB и ключ HMAC identity (штамп учётных данных в порту
 * `IdentityAccounts`) — без Redis, почты и JWT. `.env` — как у `loadEnv`.
 */
export const cliEnv = {
  load(source: NodeJS.ProcessEnv = process.env) {
    if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');
    return z.object({ ...mongoEnvShape, EMAIL_TOKEN_SECRET: Secret }).parse(source);
  },
};
export type CliEnv = ReturnType<typeof cliEnv.load>;

/** Только `MONGO_URL` — для `db:migrate`: отдельному шагу деплоя не нужны Redis и почта. `.env` — как у `loadEnv`. */
export function loadMongoUrl(source: NodeJS.ProcessEnv = process.env): string {
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');
  return z.object(mongoEnvShape).parse(source).MONGO_URL;
}
