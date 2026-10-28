import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { StandingsRecalc, type StandingsSyncRun } from './standings-recalc';

export const STANDINGS_SYNC_JOB = 'sync';

/** Разовая задача без дублей (jobId): прогон при старте worker — снимки сезонов после выката строятся сразу. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;
export const STANDINGS_SYNC_BOOT_JOB_ID = 'standings.sync.boot';

/** Расписание сверки рейтинга сезонов; upsert идемпотентен — несколько worker не плодят дубли. */
export const STANDINGS_SCHEDULES = [
  {
    id: 'standings.sync',
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: STANDINGS_SYNC_JOB },
  },
] as const;

/**
 * Регламент рейтинга сезона (`standings-recalc`, race-results-08, DV-1): каждую минуту и при старте worker — сверка
 * отпечатков источника и пересчёт изменившихся сезонов. Отказ сезона — задача падает (failed-набор BullMQ), следующий
 * прогон повторяет.
 */
@Processor(QUEUE.standingsRecalc)
export class StandingsSyncProcessor extends WorkerHost {
  constructor(private readonly recalc: StandingsRecalc) {
    super();
  }

  async process(job: Job): Promise<StandingsSyncRun> {
    if (job.name !== STANDINGS_SYNC_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.standingsRecalc}`);
    }
    return this.recalc.sync();
  }
}

@Injectable()
export class StandingsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.standingsRecalc) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of STANDINGS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    await this.queue.add(
      STANDINGS_SYNC_JOB,
      {},
      { jobId: STANDINGS_SYNC_BOOT_JOB_ID, ...ONE_SHOT },
    );
  }
}
