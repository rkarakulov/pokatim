import { type DynamicModule, Module } from '@nestjs/common';
import { ClockModule, ENV } from '@rkarakulov/api-kit/core';
import { MongoModule } from '@rkarakulov/api-kit/mongo';

import type { CliEnv } from '../config/env';
import { PanelCoreModule } from '../modules/panel';

/**
 * Контекст CLI панели: окружение (MongoDB + ключ HMAC, `cliEnv`), часы, MongoDB и данные панели — без HTTP, Redis,
 * очередей и почты. Окружение передаётся явно (тест — тестовая БД); `ENV` — глобально, как у `ConfigModule`.
 */
@Module({})
export class PanelCliModule {
  static forRoot(env: CliEnv): DynamicModule {
    return {
      module: PanelCliModule,
      global: true,
      imports: [ClockModule, MongoModule.forRoot(), PanelCoreModule],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
