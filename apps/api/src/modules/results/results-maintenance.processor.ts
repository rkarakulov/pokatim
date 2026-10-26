import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { ResultsRecheck } from './results-recheck';

export const RESULTS_REQUEUE_STUCK_JOB = 'requeue-stuck';

/** Расписание регламента результатов; upsert идемпотентен — несколько worker не плодят дубли. */
export const RESULTS_SCHEDULES = [
  {
    id: 'results.maintenance',
    repeat: { pattern: '*/10 * * * *', tz: 'Europe/Minsk' },
    job: { name: RESULTS_REQUEUE_STUCK_JOB },
  },
] as const;

/** Состояния задачи BullMQ, в которых она ещё будет выполнена. */
const PENDING_JOB_STATES: readonly string[] = [
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
];

/**
 * Регламент (`results-maintenance`, каждые 10 мин): повторная постановка зависших проверок; `queued` с живой задачей
 * в `attempt-check` (по `jobId`) — не зависшая, а ждёт очередь.
 */
@Processor(QUEUE.resultsMaintenance)
export class ResultsMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly recheck: ResultsRecheck,
    @InjectQueue(QUEUE.attemptCheck) private readonly checks: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<{ requeued: number; failed: number }> {
    if (job.name !== RESULTS_REQUEUE_STUCK_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.resultsMaintenance}`);
    }
    return this.recheck.requeueStuck({ jobPending: (jobId) => this.jobPending(jobId) });
  }

  private async jobPending(jobId: string): Promise<boolean> {
    const job = await this.checks.getJob(jobId);
    return job ? PENDING_JOB_STATES.includes(await job.getState()) : false;
  }
}

@Injectable()
export class ResultsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.resultsMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of RESULTS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
  }
}
