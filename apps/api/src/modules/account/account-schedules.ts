import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { ACCOUNT_ERASURE_RESUME_JOB } from './account.events';

/** Расписание регламента удаления аккаунтов; upsert идемпотентен — несколько worker не плодят дубли. */
export const ACCOUNT_SCHEDULES = [
  {
    id: 'account.erasure-resume.hourly',
    repeat: { pattern: '17 * * * *', tz: 'Europe/Minsk' },
    job: { name: ACCOUNT_ERASURE_RESUME_JOB },
  },
] as const;

@Injectable()
export class AccountSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.accountDeletion) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of ACCOUNT_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
  }
}
