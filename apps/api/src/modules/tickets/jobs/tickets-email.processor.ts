import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { DelayedError, type Job } from 'bullmq';

import { QUEUE } from '../../../queues';
import { TICKETS_ISSUED } from '../tickets.events';
import {
  TicketEmailBusyError,
  TicketEmailHandler,
  type TicketEmailOutcome,
} from './ticket-email.handler';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Очередь `tickets-email`: письмо «Вы зарегистрированы» по событию `tickets.issued`; незнакомое имя — ошибка. Письмо
 * под чужим живым захватом — задача откладывается до конца захвата (`moveToDelayed`, попытка не тратится): упавший
 * worker не съедает ретраи, письмо уходит после истечения его захвата.
 */
@Processor(QUEUE.ticketsEmail)
export class TicketsEmailProcessor extends WorkerHost {
  constructor(private readonly emails: TicketEmailHandler) {
    super();
  }

  async process(job: Job<OutboxJobData>, token?: string): Promise<TicketEmailOutcome> {
    if (job.name !== TICKETS_ISSUED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.ticketsEmail}`);
    }
    try {
      return await this.emails.handle(job.data.outboxEventId, { final: isFinal(job) });
    } catch (error) {
      if (!(error instanceof TicketEmailBusyError) || token === undefined) throw error;
      await job.moveToDelayed(error.until.getTime() + 1000, token);
      throw new DelayedError();
    }
  }
}
