import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import { QUEUE } from '../../../queues';
import { IDENTITY_POLICY } from '../identity.policy';
import { IdentityRepository } from '../identity.repository';

export const CLEANUP_UNVERIFIED_JOB = 'cleanup-unverified';

/** V-10: неподтверждённые аккаунты старше 7 дней удаляются (адрес освобождается). Пачками, идемпотентно. */
@Processor(QUEUE.identityMaintenance)
export class CleanupUnverifiedProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupUnverifiedProcessor.name);

  constructor(
    private readonly repository: IdentityRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job): Promise<number> {
    if (job.name !== CLEANUP_UNVERIFIED_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.identityMaintenance}`);
    }
    return this.run();
  }

  async run(batchSize: number = IDENTITY_POLICY.cleanupBatchSize): Promise<number> {
    const createdBefore = new Date(
      this.clock.now().getTime() - IDENTITY_POLICY.unverifiedRetentionMs,
    );
    let total = 0;
    for (;;) {
      const deleted = await this.repository.deleteUnverifiedBatch(createdBefore, batchSize);
      total += deleted;
      if (deleted < batchSize) break;
    }
    this.logger.log(`deleted ${total} unverified accounts`);
    return total;
  }
}
