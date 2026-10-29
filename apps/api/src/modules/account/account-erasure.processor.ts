import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { AccountErasureService } from './account-erasure.service';
import {
  ACCOUNT_DELETION_REQUESTED,
  ACCOUNT_DELETION_SWEEP_JOB,
  ACCOUNT_ERASURE_RESUME_JOB,
  ACCOUNT_ERASURE_RETRY_REQUESTED,
  AccountDeletionRequested,
  AccountErasureRetryRequested,
  AccountDeletionSweep,
} from './account.events';

/** Последняя попытка задачи BullMQ (5 попыток, экспонента — `QueueModule`). */
const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Единственный процессор очереди `account-deletion`: разбор по имени задачи — событие outbox
 * `account.deletion-requested` (первый проход), `account.deletion-sweep` и событие outbox повтора из панели
 * `account.erasure-retry-requested` (повторный проход) и регламент
 * `account.erasure-resume`. Незнакомое имя или payload не по схеме — ошибка, а не тихий пропуск.
 */
@Processor(QUEUE.accountDeletion)
export class AccountErasureProcessor extends WorkerHost {
  constructor(
    private readonly erasure: AccountErasureService,
    private readonly reader: MongoOutboxReader,
  ) {
    super();
  }

  async process(job: Job): Promise<string | number> {
    switch (job.name) {
      case ACCOUNT_DELETION_REQUESTED: {
        const { outboxEventId } = job.data as OutboxJobData;
        const event = AccountDeletionRequested.parse(await this.reader.payloadOf(outboxEventId));
        return this.erasure.run(event.userId, { pass: 'first', final: isFinal(job) });
      }
      case ACCOUNT_DELETION_SWEEP_JOB: {
        const { userId } = AccountDeletionSweep.parse(job.data);
        return this.erasure.run(userId, { pass: 'sweep', final: isFinal(job) });
      }
      case ACCOUNT_ERASURE_RETRY_REQUESTED: {
        const { outboxEventId } = job.data as OutboxJobData;
        const event = AccountErasureRetryRequested.parse(
          await this.reader.payloadOf(outboxEventId),
        );
        return this.erasure.run(event.userId, { pass: 'sweep', final: isFinal(job) });
      }
      case ACCOUNT_ERASURE_RESUME_JOB:
        return this.erasure.resume();
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.accountDeletion}`);
    }
  }
}
