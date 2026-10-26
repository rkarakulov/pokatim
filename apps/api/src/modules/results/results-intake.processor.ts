import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import {
  TRACK_ACTIVITY_READY,
  TRACK_ACTIVITY_REMOVED,
  TrackActivityReady,
  TrackActivityRemoved,
} from '../tracks';
import { AttemptIntake } from './attempt-intake';
import { RESULTS_ENTRY_CREATED, ResultsEntryCreated } from './results.events';

/**
 * Приём попыток (`results-intake`, jobId = id события outbox): события `tracks` (`activity-ready`,
 * `activity-removed`) и своя «заявка создана» → `AttemptIntake`. Задачи идемпотентны: состояние группы читается
 * сейчас, попытка уникальна по (гонка, активность). Параллелизм — 2.
 */
@Processor(QUEUE.resultsIntake, { concurrency: 2 })
export class ResultsIntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(ResultsIntakeProcessor.name);

  constructor(
    private readonly intake: AttemptIntake,
    private readonly outbox: MongoOutboxReader,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    const payload = await this.outbox.payloadOf(job.data.outboxEventId);
    if (job.name === TRACK_ACTIVITY_READY) {
      const event = TrackActivityReady.safeParse(payload);
      if (event.success) await this.intake.activityReady(event.data.activityId, event.data.userId);
      else this.skip(job);
      return;
    }
    if (job.name === TRACK_ACTIVITY_REMOVED) {
      const event = TrackActivityRemoved.safeParse(payload);
      if (event.success) {
        await this.intake.activityRemoved(
          event.data.activityId,
          event.data.userId,
          event.data.primaryActivityId,
        );
      } else this.skip(job);
      return;
    }
    if (job.name === RESULTS_ENTRY_CREATED) {
      const event = ResultsEntryCreated.safeParse(payload);
      if (event.success) await this.intake.entryCreated(event.data.entryId);
      else this.skip(job);
      return;
    }
    throw new Error(`unknown job ${job.name} in queue ${QUEUE.resultsIntake}`);
  }

  private skip(job: Job<OutboxJobData>): void {
    this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
  }
}
