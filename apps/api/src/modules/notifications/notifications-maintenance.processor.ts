import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { DeliveryJobs } from './delivery-jobs';
import { NOTIFICATIONS_RECEIPTS_JOB, NOTIFICATIONS_REDELIVER_JOB } from './notifications.events';
import { PushReceipts } from './push-receipts';

/** Расписание регламента уведомлений; upsert идемпотентен — несколько worker не плодят дубли. */
export const NOTIFICATIONS_SCHEDULES = [
  {
    id: 'notifications.receipts',
    repeat: { pattern: '*/15 * * * *', tz: 'Europe/Minsk' },
    job: { name: NOTIFICATIONS_RECEIPTS_JOB },
  },
  {
    id: 'notifications.redeliver',
    repeat: { pattern: '*/10 * * * *', tz: 'Europe/Minsk' },
    job: { name: NOTIFICATIONS_REDELIVER_JOB },
  },
] as const;

/**
 * Регламент уведомлений (`notifications-maintenance`): квитанции Expo (`DeviceNotRegistered` снимает токен) и
 * перепостановка потерянных задач доставки.
 */
@Processor(QUEUE.notificationsMaintenance)
export class NotificationsMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly receipts: PushReceipts,
    private readonly jobs: DeliveryJobs,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case NOTIFICATIONS_RECEIPTS_JOB:
        return this.receipts.check();
      case NOTIFICATIONS_REDELIVER_JOB:
        return this.jobs.redeliver();
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.notificationsMaintenance}`);
    }
  }
}

@Injectable()
export class NotificationsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.notificationsMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of NOTIFICATIONS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
  }
}
