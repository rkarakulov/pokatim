import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { RouteDerivedBackfill, type RouteDerivedRun } from './route-derived';

export const ROUTES_DERIVE_JOB = 'derive';

/** Разовая задача без дублей (jobId): прогон при старте worker (RC-13). */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;
export const ROUTES_DERIVE_BOOT_JOB_ID = 'routes.derive.boot';
/** Пачек за одну задачу не больше (≤ 200 маршрутов): остаток — следующим прогоном по расписанию. */
export const ROUTES_DERIVE_MAX_BATCHES = 10;

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
 * при старте worker). Полная пачка с прогрессом — следующая пачка в той же задаче (каждый маршрут отпускает семафор
 * потоков разбора), не больше `ROUTES_DERIVE_MAX_BATCHES`. Продолжение отдельной задачей с постоянным `jobId` BullMQ
 * отбросил бы как дубль ещё не удалённой текущей (ревью pass 1, F1); пачка без прогресса (одни пропуски) — стоп.
 */
@Processor(QUEUE.routesMaintenance)
export class RoutesMaintenanceProcessor extends WorkerHost {
  constructor(private readonly backfill: RouteDerivedBackfill) {
    super();
  }

  async process(job: Job): Promise<RouteDerivedRun> {
    if (job.name !== ROUTES_DERIVE_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routesMaintenance}`);
    }
    const total: RouteDerivedRun = { derived: 0, failed: 0, skipped: 0, more: false };
    for (let batch = 0; batch < ROUTES_DERIVE_MAX_BATCHES; batch += 1) {
      const run = await this.backfill.run();
      total.derived += run.derived;
      total.failed += run.failed;
      total.skipped += run.skipped;
      total.more = run.more;
      if (!run.more || run.derived + run.failed === 0) break;
    }
    return total;
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
