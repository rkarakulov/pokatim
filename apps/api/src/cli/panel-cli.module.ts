import { type DynamicModule, Module } from '@nestjs/common';
import { ClockModule, ENV } from '@rkarakulov/api-kit/core';
import { MongoModule, MongoOutboxModule } from '@rkarakulov/api-kit/mongo';

import type { CliEnv } from '../config/env';
import { PanelCoreModule } from '../modules/panel';
import { ProfileCoreModule } from '../modules/profile';

/**
 * Контекст CLI панели: окружение (MongoDB + ключ HMAC, `cliEnv`), часы, MongoDB, outbox и данные панели — без HTTP,
 * Redis, очередей и почты. Окружение передаётся явно (тест — тестовая БД); `ENV` — глобально, как у `ConfigModule`.
 */
@Module({})
export class PanelCliModule {
  static forRoot(env: CliEnv): DynamicModule {
    return {
      module: PanelCliModule,
      global: true,
      // outbox — только MongoDB (без Redis): `grant-admin` ставит письмо о роли (ADR-0026)
      imports: [
        ClockModule,
        MongoModule.forRoot(),
        MongoOutboxModule,
        PanelCoreModule,
        // `reserved-names` — выборка служебных подписей профилей (только чтение, N8)
        ProfileCoreModule,
      ],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
