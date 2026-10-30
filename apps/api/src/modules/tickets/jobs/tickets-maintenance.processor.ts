import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../../queues';
import { RaceTickets, type TicketsReconcileRun } from '../race-tickets';
import { TicketReminders, type TicketRemindersRun } from '../ticket-reminders';

export const TICKETS_RECONCILE_JOB = 'tickets.reconcile';
export const TICKETS_RECONCILE_BOOT_JOB_ID = 'tickets.reconcile.boot';
/** PR D: напоминания участникам (RC-D2). */
export const TICKETS_REMINDERS_JOB = 'tickets.reminders';
export const TICKETS_REMINDERS_BOOT_JOB_ID = 'tickets.reminders.boot';

/** Разовая задача без дублей (jobId): сверка при старте worker. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;

/** Расписание сверки билетов гонок и напоминаний; upsert идемпотентен — несколько worker не плодят дубли. */
export const TICKETS_SCHEDULES = [
  {
    id: TICKETS_RECONCILE_JOB,
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: TICKETS_RECONCILE_JOB },
    bootJobId: TICKETS_RECONCILE_BOOT_JOB_ID,
  },
  {
    id: TICKETS_REMINDERS_JOB,
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: TICKETS_REMINDERS_JOB },
    bootJobId: TICKETS_REMINDERS_BOOT_JOB_ID,
  },
] as const;

/**
 * Регламент билетов (`tickets-maintenance`, event-tickets): каждую минуту и при старте worker — сверка билетов гонок
 * с заявками (выпуск, отмена, категория) и напоминания участникам (PR D). Отказ гонки или события — задача падает
 * после прохода остальных (failed-набор), следующий прогон повторяет.
 */
@Processor(QUEUE.ticketsMaintenance)
export class TicketsMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly raceTickets: RaceTickets,
    private readonly reminders: TicketReminders,
  ) {
    super();
  }

  async process(job: Job): Promise<TicketsReconcileRun | TicketRemindersRun> {
    switch (job.name) {
      case TICKETS_RECONCILE_JOB:
        return this.raceTickets.reconcileAll();
      case TICKETS_REMINDERS_JOB:
        return this.reminders.dispatchDue();
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.ticketsMaintenance}`);
    }
  }
}

@Injectable()
export class TicketsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.ticketsMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of TICKETS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    for (const schedule of TICKETS_SCHEDULES) {
      await this.queue.add(schedule.job.name, {}, { jobId: schedule.bootJobId, ...ONE_SHOT });
    }
  }
}
