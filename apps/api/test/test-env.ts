import { env, type Env } from '../src/config/env';

// тестовая база — `<имя dev-БД>_test` в replica set из infra/docker-compose.dev.yml
const DB = 'pokatim';

// тестовые адреса задаются только переменными *_TEST — dev-базу тесты не трогают
export const MONGO_URL_TEST =
  process.env.MONGO_URL_TEST ?? `mongodb://127.0.0.1:27017/${DB}_test?directConnection=true`;
export const REDIS_URL_TEST = process.env.REDIS_URL_TEST ?? 'redis://127.0.0.1:6379/1';

/** Окружение API для тестов: несекретные фиктивные значения, SMTP не используется (fake MAILER). */
export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  // явный источник: .env разработчика не читается
  return env.load({
    NODE_ENV: 'test',
    MONGO_URL: MONGO_URL_TEST,
    REDIS_URL: REDIS_URL_TEST,
    SMTP_URL: 'smtp://127.0.0.1:1025',
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0000',
    EMAIL_TOKEN_SECRET: 'test-email-secret-test-email-secret-0',
    MAIL_FROM: 'pokatim <no-reply@pokatim.test>',
    APP_LINK_BASE: 'pokatim://',
    AGREEMENT_VERSION: 'test-agreement',
    TRUST_PROXY: '0',
    ...overrides,
  });
}
