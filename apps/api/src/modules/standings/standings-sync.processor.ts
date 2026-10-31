import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import {
  RESULTS_PROTOCOL_PUBLISHED,
  RESULTS_RESULT_REVISED,
  ResultsProtocolPublished,
  ResultsResultRevised,
} from '../results';
import { type RaceSyncOutcome, StandingsRecalc, type StandingsSyncRun } from './standings-recalc';

export const STANDINGS_SYNC_JOB = 'sync';

/** Разовая задача без дублей (jobId): прогон при старте worker — снимки сезонов после выката строятся сразу. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;
export const STANDINGS_SYNC_BOOT_JOB_ID = 'standings.sync.boot';

/**
 * Расписание сверки рейтинга сезонов — страховка к событиям (standings-outbox-events, S1): задача события, исчерпавшая
 * ретраи, лечится за ≤ 15 мин. upsert идемпотентен — несколько worker не плодят дубли.
 */
export const STANDINGS_SCHEDULES = [
  {
    id: 'standings.sync',
    repeat: { pattern: '*/15 * * * *', tz: 'Europe/Minsk' },
    job: { name: STANDINGS_SYNC_JOB },
  },
] as const;

/** Схемы событий `results`, на которые подписан рейтинг (`standingsOutboxRoutes`). */
const RACE_EVENTS: Record<string, typeof ResultsProtocolPublished | typeof ResultsResultRevised> = {
  [RESULTS_PROTOCOL_PUBLISHED]: ResultsProtocolPublished,
  [RESULTS_RESULT_REVISED]: ResultsResultRevised,
};

/**
 * Очередь рейтинга сезона (`standings-recalc`): события `results` (имя задачи = тип, jobId = id события outbox) —
 * сверка сезона гонки (`StandingsRecalc.syncRace`); `sync` — регламент-страховка каждые 15 мин и при старте worker.
 * Отказ — задача падает (ретраи BullMQ, failed-набор), регламент повторяет. Невалидный payload — пропуск с логом.
 */
@Processor(QUEUE.standingsRecalc)
export class StandingsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(StandingsSyncProcessor.name);

  constructor(
    private readonly recalc: StandingsRecalc,
    private readonly outbox: MongoOutboxReader,
  ) {
    super();
  }

  async process(job: Job): Promise<StandingsSyncRun | RaceSyncOutcome> {
    if (job.name === STANDINGS_SYNC_JOB) return this.recalc.sync();
    const schema = Object.hasOwn(RACE_EVENTS, job.name) ? RACE_EVENTS[job.name] : undefined;
    if (!schema) throw new Error(`unknown job ${job.name} in queue ${QUEUE.standingsRecalc}`);
    const { outboxEventId } = job.data as OutboxJobData;
    const event = schema.safeParse(await this.outbox.payloadOf(outboxEventId));
    if (!event.success) {
      this.logger.warn(`standings.event_skipped type=${job.name} event=${outboxEventId}`);
      return 'skipped';
    }
    return this.recalc.syncRace(event.data.raceId);
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
