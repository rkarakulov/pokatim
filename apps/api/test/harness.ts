import 'reflect-metadata';

import { API_VERSION } from '@pokatim/contracts';
import { createMongoApiHarness, type MongoApiHarness } from '@rkarakulov/test-kit/mongo';

import { AppModule } from '../src/app.module';
import type { Env } from '../src/config/env';
import { configureHttp } from '../src/http-app';
import { WorkerModule } from '../src/worker.module';
import { testEnv } from './test-env';

export { DAY, FakeMailer, HOUR, MINUTE, TestClock } from '@rkarakulov/test-kit/core';

/** Стенд API и worker проекта на реальных MongoDB (replica set, `*_test`) и Redis (БД 1). */
export type Harness = MongoApiHarness<Env>;

export function createHarness(envOverrides: Parameters<typeof testEnv>[0] = {}): Promise<Harness> {
  const env = testEnv(envOverrides);
  return createMongoApiHarness({
    apiModule: AppModule,
    workerModule: WorkerModule,
    env,
    httpPrefix: API_VERSION,
    // HTTP-настройка как в main.ts (CORS и своё проекта): int-тесты видят те же заголовки и отказы
    configureApp: (app) => configureHttp(app, env),
  });
}
