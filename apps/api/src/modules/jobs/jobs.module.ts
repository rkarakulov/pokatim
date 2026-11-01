import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { FailedJobQueues } from './failed-job-queues';
import { FailedJobsAdminController } from './failed-jobs-admin.controller';
import { FailedJobsAdminService } from './failed-jobs-admin.service';

/**
 * Фоновые очереди в панели (admin-failed-jobs): модуль-композиция без своих коллекций — очереди BullMQ поверх общего
 * `REDIS`, события outbox базы (только чтение), журнал и гард — `panel` через `index.ts`. Импортирует только `AppModule`.
 */
@Module({
  imports: [PanelModule],
  controllers: [FailedJobsAdminController],
  providers: [FailedJobQueues, FailedJobsAdminService],
})
export class JobsModule {}
