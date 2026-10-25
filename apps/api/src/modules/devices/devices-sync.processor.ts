import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import type { ZodType } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_UPLOAD_DELETED, TrackUploadDeleted } from '../tracks';
import { type Attempt, DevicesSyncService } from './devices-sync.service';
import {
  DEVICES_CONNECTED,
  DEVICES_PULL_JOB,
  DEVICES_REVOKE_REQUESTED,
  DevicesConnected,
  DevicesPullJob,
  DevicesRevokeRequested,
} from './devices.events';

/** Последняя попытка задачи BullMQ (5 попыток, экспонента — `QueueModule`). */
const attemptOf = (job: Job): Attempt => ({
  final: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
});

/**
 * Единственный процессор очереди `devices-sync`: разбор по имени задачи — `pull` (данные задачи — id подключения),
 * события outbox `devices.connected` (история + первый pull), `devices.revoke-requested` (отзыв), чужое
 * `tracks.upload-deleted` (надгробие импорта). Незнакомое имя или payload не по схеме — ошибка, а не тихий пропуск.
 */
@Processor(QUEUE.devicesSync)
export class DevicesSyncProcessor extends WorkerHost {
  constructor(
    private readonly sync: DevicesSyncService,
    private readonly reader: MongoOutboxReader,
  ) {
    super();
  }

  async process(job: Job): Promise<string> {
    switch (job.name) {
      case DEVICES_PULL_JOB:
        return this.sync.pull(DevicesPullJob.parse(job.data).connectionId, attemptOf(job));
      case DEVICES_CONNECTED:
        return this.sync.onConnected((await this.payload(job, DevicesConnected)).connectionId);
      case DEVICES_REVOKE_REQUESTED:
        return this.sync.revoke(await this.payload(job, DevicesRevokeRequested), attemptOf(job));
      case TRACK_UPLOAD_DELETED: {
        const event = await this.payload(job, TrackUploadDeleted);
        return this.sync.onUploadDeleted(event.source, event.sourceRef);
      }
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.devicesSync}`);
    }
  }

  private async payload<T>(job: Job, schema: ZodType<T>): Promise<T> {
    const { outboxEventId } = job.data as OutboxJobData;
    return schema.parse(await this.reader.payloadOf(outboxEventId));
  }
}
