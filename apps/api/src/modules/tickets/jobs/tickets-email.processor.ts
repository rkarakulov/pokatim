import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import { QUEUE } from '../../../queues';
import { TICKETS_ISSUED } from '../tickets.events';
import { TicketEmailHandler, type TicketEmailOutcome } from './ticket-email.handler';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/** Очередь `tickets-email`: письмо «Вы зарегистрированы» по событию `tickets.issued`; незнакомое имя — ошибка. */
@Processor(QUEUE.ticketsEmail)
export class TicketsEmailProcessor extends WorkerHost {
  constructor(private readonly emails: TicketEmailHandler) {
    super();
  }

  process(job: Job<OutboxJobData>): Promise<TicketEmailOutcome> {
    if (job.name !== TICKETS_ISSUED) {
      return Promise.reject(new Error(`unknown job ${job.name} in queue ${QUEUE.ticketsEmail}`));
    }
    return this.emails.handle(job.data.outboxEventId, { final: isFinal(job) });
  }
}
