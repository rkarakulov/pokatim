import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter } from '@rkarakulov/api-kit/core';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { configureHttp } from './http-app';

async function bootstrap(): Promise<void> {
  const config = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(config),
  );
  configureHttp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
