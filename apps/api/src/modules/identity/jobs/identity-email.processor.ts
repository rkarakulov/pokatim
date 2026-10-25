import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import { QUEUE } from '../../../queues';
import {
  PASSWORD_CHANGED_EMAIL_REQUESTED,
  PASSWORD_RESET_EMAIL_REQUESTED,
  VERIFICATION_EMAIL_REQUESTED,
} from '../identity.events';
import { LinkEmailHandler } from './link-email.handler';
import { PasswordChangedEmailHandler } from './password-changed-email.handler';

export type IdentityEmailOutcome = 'sent' | 'skipped';

/**
 * Единственный процессор очереди `identity-email` (R6 слайса 3): BullMQ раздаёт задачи очереди любому процессору,
 * поэтому разбор — по имени задачи (тип события outbox), обработка — в обработчиках. Незнакомое имя — ошибка
 * (ретрай и видимый провал), а не тихий пропуск.
 */
@Processor(QUEUE.identityEmail)
export class IdentityEmailProcessor extends WorkerHost {
  constructor(
    private readonly linkEmails: LinkEmailHandler,
    private readonly passwordChanged: PasswordChangedEmailHandler,
  ) {
    super();
  }

  process(job: Job<OutboxJobData>): Promise<IdentityEmailOutcome> {
    const { outboxEventId } = job.data;
    switch (job.name) {
      case VERIFICATION_EMAIL_REQUESTED:
        return this.linkEmails.handle('verification', outboxEventId);
      case PASSWORD_RESET_EMAIL_REQUESTED:
        return this.linkEmails.handle('passwordReset', outboxEventId);
      case PASSWORD_CHANGED_EMAIL_REQUESTED:
        return this.passwordChanged.handle(outboxEventId);
      default:
        return Promise.reject(new Error(`unknown job ${job.name} in queue ${QUEUE.identityEmail}`));
    }
  }
}
