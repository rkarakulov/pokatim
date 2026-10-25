import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env, type Env } from '../src/config/env';
import { MONGO_URL_TEST, REDIS_URL_TEST } from './test-urls';

export { MONGO_URL_TEST, REDIS_URL_TEST };

/** Хранилище исходников заездов тестов — временный каталог процесса (файлы тестов чистят сами). */
export const TRACK_STORAGE_DIR_TEST = join(tmpdir(), `pokatim-test-trackfiles-${process.pid}`);

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
    TRACK_STORAGE_DIR: TRACK_STORAGE_DIR_TEST,
    TRACK_STORAGE_MIN_FREE_BYTES: '0',
    ...overrides,
  });
}
