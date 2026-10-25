import { Module } from '@nestjs/common';
import { ClockModule, ConfigModule, MailModule, QueueModule } from '@rkarakulov/api-kit/core';
import {
  MongoModule,
  MongoOutboxModule,
  MongoOutboxPublisherModule,
} from '@rkarakulov/api-kit/mongo';

import { env } from './config/env';
import { identityOutboxRoutes, IdentityWorkerModule } from './modules/identity';
import { TracksWorkerModule } from './modules/tracks';

/** Отдельный процесс: задачи очередей (письма, тяжёлая обработка) не блокируют API. */
@Module({
  imports: [
    ConfigModule.forRoot(env),
    ClockModule,
    MongoModule.forRoot(),
    QueueModule,
    MailModule,
    MongoOutboxModule,
    // composition root: какие события outbox в какие очереди (`{ ...<модуль>OutboxRoutes }`)
    MongoOutboxPublisherModule.forRoot({ routes: { ...identityOutboxRoutes } }),
    TracksWorkerModule,
    IdentityWorkerModule,
  ],
})
export class WorkerModule {}
