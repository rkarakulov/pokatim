import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { RideAskSweep, type RideAskRun } from './ride-ask-sweep';

export const SOCIAL_RIDE_ASK_JOB = 'social.ride-ask';
export const SOCIAL_RIDE_ASK_BOOT_JOB_ID = 'social.ride-ask.boot';

/** Разовая задача без дублей (jobId): прогон при старте worker. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;

/** Расписание регламента «Свои»; upsert идемпотентен — несколько worker не плодят дубли. */
export const SOCIAL_SCHEDULES = [
  {
    id: SOCIAL_RIDE_ASK_JOB,
    repeat: { pattern: '*/30 * * * *', tz: 'Europe/Minsk' },
    job: { name: SOCIAL_RIDE_ASK_JOB },
    bootJobId: SOCIAL_RIDE_ASK_BOOT_JOB_ID,
  },
] as const;

/**
 * Регламент «Свои» (`social-maintenance`, P5): раз в 30 минут и при старте worker — отбор адресатов «Как прошёл
 * райд?» (`RideAskSweep`, отправка — P7). Незнакомое имя — бросок; сбой райда — задача падает после прохода остальных.
 */
@Processor(QUEUE.socialMaintenance)
export class SocialMaintenanceProcessor extends WorkerHost {
  constructor(private readonly rideAsk: RideAskSweep) {
    super();
  }

  async process(job: Job): Promise<RideAskRun> {
    switch (job.name) {
      case SOCIAL_RIDE_ASK_JOB:
        return this.rideAsk.run();
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.socialMaintenance}`);
    }
  }
}

@Injectable()
export class SocialSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.socialMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of SOCIAL_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    for (const schedule of SOCIAL_SCHEDULES) {
      await this.queue.add(schedule.job.name, {}, { jobId: schedule.bootJobId, ...ONE_SHOT });
    }
  }
}
