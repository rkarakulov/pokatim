import { Module } from '@nestjs/common';
import {
  ClockModule,
  ConfigModule,
  MailModule,
  QueueModule,
  RedisModule,
} from '@rkarakulov/api-kit/core';
import {
  MongoModule,
  MongoOutboxModule,
  MongoOutboxPublisherModule,
} from '@rkarakulov/api-kit/mongo';

import { env } from './config/env';
import { identityOutboxRoutes, IdentityWorkerModule } from './modules/identity';
import { devicesOutboxRoutes, DevicesWorkerModule } from './modules/devices';
import { routesOutboxRoutes, RoutesWorkerModule } from './modules/routes';
import { tracksOutboxRoutes, TracksWorkerModule } from './modules/tracks';

/** Отдельный процесс: задачи очередей (письма, тяжёлая обработка) не блокируют API. */
@Module({
  imports: [
    ConfigModule.forRoot(env),
    ClockModule,
    MongoModule.forRoot(),
    QueueModule,
    // лимиты и кеш квоты хранилища, замки синхронизации устройств
    RedisModule,
    MailModule,
    MongoOutboxModule,
    // composition root: какие события outbox в какие очереди (`{ ...<модуль>OutboxRoutes }`)
    MongoOutboxPublisherModule.forRoot({
      routes: {
        ...identityOutboxRoutes,
        ...tracksOutboxRoutes,
        ...devicesOutboxRoutes,
        ...routesOutboxRoutes,
      },
    }),
    TracksWorkerModule,
    IdentityWorkerModule,
    DevicesWorkerModule,
    RoutesWorkerModule,
  ],
})
export class WorkerModule {}
