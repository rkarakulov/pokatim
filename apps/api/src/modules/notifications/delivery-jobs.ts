import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import {
  type EmailJobData,
  emailJobId,
  NOTIFICATIONS_EMAIL_JOB,
  NOTIFICATIONS_PUSH_JOB,
  type PushJobData,
  pushJobId,
} from './notifications.events';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

/** Состояния задачи BullMQ, в которых она ещё будет выполнена (та же задача — не ставим заново). */
const PENDING_JOB_STATES: readonly string[] = [
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
];

/**
 * Постановка задач доставки с детерминированными jobId (`pushJobId`, `emailJobId`): повтор intake ставит ту же задачу.
 * Завершённая задача с тем же jobId (BullMQ хранит её и молча отбросил бы новую) удаляется и ставится заново —
 * новое уведомление в тот же миг или перепостановка регламентом не теряются. Задача сама проверяет состояние в
 * документе (захват), лишний запуск ничего не шлёт.
 */
@Injectable()
export class DeliveryJobs {
  private readonly logger = new Logger(DeliveryJobs.name);

  constructor(
    @InjectQueue(QUEUE.notificationsDelivery) private readonly queue: Queue,
    private readonly repository: NotificationsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Задачи по уведомлениям события в `pending` (после записи intake). Возвращает число поставленных. */
  async scheduleEvent(sourceEventId: string): Promise<number> {
    const pending = await this.repository.pendingDeliveriesOf(sourceEventId);
    let scheduled = 0;
    for (const doc of pending) {
      if (doc.push.state === 'pending') {
        scheduled += Number(await this.schedulePush(doc.userId, doc.push.notBefore));
      }
      if (doc.email?.state === 'pending') scheduled += Number(await this.scheduleEmail(doc._id));
    }
    return scheduled;
  }

  /** Push пользователя к сроку `notBefore` (задержка до него). */
  schedulePush(userId: string, notBefore: Date): Promise<boolean> {
    const data: PushJobData = { userId };
    const delay = Math.max(0, notBefore.getTime() - this.clock.now().getTime());
    return this.ensure(NOTIFICATIONS_PUSH_JOB, data, pushJobId(userId, notBefore), delay);
  }

  scheduleEmail(notificationId: string): Promise<boolean> {
    const data: EmailJobData = { notificationId };
    return this.ensure(NOTIFICATIONS_EMAIL_JOB, data, emailJobId(notificationId), 0);
  }

  /**
   * Регламент: потерянные задачи — `pending` дольше 10 мин после срока (письмо — после создания) и истёкший захват
   * `sending` — ставятся заново с теми же jobId. Живая задача с тем же jobId — пропуск.
   */
  async redeliver(): Promise<{ push: number; email: number }> {
    const now = this.clock.now();
    const before = new Date(now.getTime() - NOTIFICATIONS_POLICY.redeliverAfterMs);
    let push = 0;
    for (const stuck of await this.repository.stuckPush(
      before,
      now,
      NOTIFICATIONS_POLICY.redeliverBatch,
    )) {
      push += Number(await this.schedulePush(stuck.userId, stuck.notBefore));
    }
    let email = 0;
    for (const id of await this.repository.stuckEmails(
      before,
      now,
      NOTIFICATIONS_POLICY.redeliverBatch,
    )) {
      email += Number(await this.scheduleEmail(id));
    }
    if (push + email > 0) this.logger.log(`notifications.redeliver push=${push} email=${email}`);
    return { push, email };
  }

  private async ensure(name: string, data: object, jobId: string, delay: number): Promise<boolean> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      if (PENDING_JOB_STATES.includes(await existing.getState())) return false;
      await existing.remove();
    }
    await this.queue.add(name, data, { jobId, ...(delay > 0 ? { delay } : {}) });
    return true;
  }
}
