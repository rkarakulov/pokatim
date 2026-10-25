import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';

export interface TrackProcessingJob {
  trackUploadId: string;
}

/**
 * Заглушка: парсинг файла, проверка коридора (`@pokatim/tracks` в worker, ADR-0007), пересчёт результата. Сервер —
 * единственный авторитет.
 */
@Processor(QUEUE.trackProcessing)
export class TrackProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackProcessingProcessor.name);

  async process(job: Job<TrackProcessingJob>): Promise<void> {
    this.logger.log(`track upload ${job.data.trackUploadId}: not implemented yet`);
  }
}
