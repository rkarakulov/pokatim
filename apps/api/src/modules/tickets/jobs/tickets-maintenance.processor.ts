import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../../queues';
import { RaceTickets, type TicketsReconcileRun } from '../race-tickets';

export const TICKETS_RECONCILE_JOB = 'tickets.reconcile';
export const TICKETS_RECONCILE_BOOT_JOB_ID = 'tickets.reconcile.boot';

/** Разовая задача без дублей (jobId): сверка при старте worker. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;

/** Расписание сверки билетов гонок; upsert идемпотентен — несколько worker не плодят дубли. */
export const TICKETS_SCHEDULES = [
  {
    id: TICKETS_RECONCILE_JOB,
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: TICKETS_RECONCILE_JOB },
  },
] as const;

/**
 * Регламент билетов (`tickets-maintenance`, event-tickets): каждую минуту и при старте worker — сверка билетов гонок
 * с заявками (выпуск, отмена, категория). Отказ гонки — задача падает после прохода остальных (failed-набор),
 * следующий прогон повторяет.
 */
@Processor(QUEUE.ticketsMaintenance)
export class TicketsMaintenanceProcessor extends WorkerHost {
  constructor(private readonly raceTickets: RaceTickets) {
    super();
  }

  async process(job: Job): Promise<TicketsReconcileRun> {
    if (job.name !== TICKETS_RECONCILE_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.ticketsMaintenance}`);
    }
    return this.raceTickets.reconcileAll();
  }
}

@Injectable()
export class TicketsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.ticketsMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of TICKETS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    await this.queue.add(
      TICKETS_RECONCILE_JOB,
      {},
      { jobId: TICKETS_RECONCILE_BOOT_JOB_ID, ...ONE_SHOT },
    );
  }
}
