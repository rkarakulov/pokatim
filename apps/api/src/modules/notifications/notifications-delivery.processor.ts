import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { EmailDelivery, type EmailOutcome } from './email-delivery';
import {
  EmailJobData,
  NOTIFICATIONS_EMAIL_JOB,
  NOTIFICATIONS_PUSH_JOB,
  PushJobData,
} from './notifications.events';
import { PushDelivery, type PushOutcome } from './push-delivery';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Доставка уведомлений (`notifications-delivery`, ADR-0016): `notifications.push` — push пользователя (jobId
 * `push-<userId>-<notBeforeMs>`), `notifications.email` — письмо уведомления (jobId `email-<id>`). Состояние — в
 * документе уведомления (захват): повтор задачи не шлёт второй push или письмо. Данные не по схеме — пропуск.
 */
@Processor(QUEUE.notificationsDelivery, { concurrency: 4 })
export class NotificationsDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsDeliveryProcessor.name);

  constructor(
    private readonly push: PushDelivery,
    private readonly email: EmailDelivery,
  ) {
    super();
  }

  async process(job: Job): Promise<PushOutcome | EmailOutcome> {
    const final = isFinal(job);
    switch (job.name) {
      case NOTIFICATIONS_PUSH_JOB: {
        const data = PushJobData.safeParse(job.data);
        if (!data.success) return this.invalid(job);
        return this.push.deliver(data.data.userId, { final });
      }
      case NOTIFICATIONS_EMAIL_JOB: {
        const data = EmailJobData.safeParse(job.data);
        if (!data.success) return this.invalid(job);
        return this.email.deliver(data.data.notificationId, { final });
      }
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.notificationsDelivery}`);
    }
  }

  private invalid(job: Job): 'skipped' {
    this.logger.warn(`notifications.delivery_invalid job=${job.name}`);
    return 'skipped';
  }
}
