import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import { QUEUE } from '../../../queues';
import { PANEL_INVITATION_EMAIL_REQUESTED, PANEL_ROLE_EMAIL_REQUESTED } from '../panel.events';
import { InvitationEmailHandler, type PanelEmailOutcome } from './invitation-email.handler';
import { RoleEmailHandler } from './role-email.handler';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Единственный процессор очереди `panel-email` (ADR-0026): разбор по имени задачи (тип события outbox) —
 * письмо-приглашение и письмо о роли; незнакомое имя — ошибка (ретрай и видимый провал), а не тихий пропуск.
 */
@Processor(QUEUE.panelEmail)
export class PanelEmailProcessor extends WorkerHost {
  constructor(
    private readonly invitations: InvitationEmailHandler,
    private readonly roles: RoleEmailHandler,
  ) {
    super();
  }

  process(job: Job<OutboxJobData>): Promise<PanelEmailOutcome> {
    const { outboxEventId } = job.data;
    switch (job.name) {
      case PANEL_INVITATION_EMAIL_REQUESTED:
        return this.invitations.handle(outboxEventId, { final: isFinal(job) });
      case PANEL_ROLE_EMAIL_REQUESTED:
        return this.roles.handle(outboxEventId, { final: isFinal(job) });
      default:
        return Promise.reject(new Error(`unknown job ${job.name} in queue ${QUEUE.panelEmail}`));
    }
  }
}
