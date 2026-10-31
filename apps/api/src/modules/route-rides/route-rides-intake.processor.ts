import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { TRACK_ACTIVITY_REMOVED, TrackActivityRemoved } from '../tracks';
import { RouteRidesRepository } from './route-rides.repository';

/**
 * Приём `tracks.activity-removed` (`route-rides-intake`, jobId = id события outbox; fan-out вместе с `results-intake`):
 * заезды удалённой активности удаляются по всем маршрутам райдера. Повтор удаляет 0; заезд на сверке теряет запись итога
 * (`record` по `_id` промахивается — `skipped`). Заезд группы на новую основную (`primaryActivityId`) не переносится.
 */
@Processor(QUEUE.routeRidesIntake)
export class RouteRidesIntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRidesIntakeProcessor.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly outbox: MongoOutboxReader,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<number | 'skipped'> {
    if (job.name !== TRACK_ACTIVITY_REMOVED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routeRidesIntake}`);
    }
    const event = TrackActivityRemoved.safeParse(
      await this.outbox.payloadOf(job.data.outboxEventId),
    );
    if (!event.success) {
      this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const { userId, activityId } = event.data;
    const deleted = await this.repository.deleteOfActivity(userId, activityId);
    if (deleted > 0)
      this.logger.log(`activity ${activityId} removed: ${deleted} route-ride(s) deleted`);
    return deleted;
  }
}
