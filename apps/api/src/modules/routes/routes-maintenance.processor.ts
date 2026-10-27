import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { RouteDerivedBackfill, type RouteDerivedRun } from './route-derived';

export const ROUTES_DERIVE_JOB = 'derive';

/** Разовые задачи без дублей (jobId): прогон при старте worker и продолжение полной пачки (RC-13). */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;
export const ROUTES_DERIVE_BOOT_JOB_ID = 'routes.derive.boot';
export const ROUTES_DERIVE_MORE_JOB_ID = 'routes.derive.more';

/** Расписание регламента маршрутов; upsert идемпотентен — несколько worker не плодят дубли. */
export const ROUTES_SCHEDULES = [
  {
    id: 'routes.maintenance',
    repeat: { pattern: '*/10 * * * *', tz: 'Europe/Minsk' },
    job: { name: ROUTES_DERIVE_JOB },
  },
] as const;

/**
 * Регламент маршрутов (`routes-maintenance`, routes-03): бэкфилл производных данных готовых маршрутов (каждые 10 мин,
 * при старте worker). Полная пачка — продолжение сразу (каждый маршрут отпускает семафор потоков разбора).
 */
@Processor(QUEUE.routesMaintenance)
export class RoutesMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly backfill: RouteDerivedBackfill,
    @InjectQueue(QUEUE.routesMaintenance) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<RouteDerivedRun> {
    if (job.name !== ROUTES_DERIVE_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routesMaintenance}`);
    }
    const run = await this.backfill.run();
    if (run.more) {
      await this.queue.add(
        ROUTES_DERIVE_JOB,
        {},
        { jobId: ROUTES_DERIVE_MORE_JOB_ID, ...ONE_SHOT },
      );
    }
    return run;
  }
}

@Injectable()
export class RoutesSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.routesMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of ROUTES_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    // прогон при старте: маршруты до слайса догоняются сразу после выката (опция `immediately` не используется)
    await this.queue.add(ROUTES_DERIVE_JOB, {}, { jobId: ROUTES_DERIVE_BOOT_JOB_ID, ...ONE_SHOT });
  }
}
