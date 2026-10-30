import { InjectFlowProducer, InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { FlowProducer, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import type { FanoutChunk } from './notification-fanout';
import { fanoutJobId, NOTIFICATIONS_FANOUT_JOB } from './notifications.events';

/** Имя `FlowProducer` постановки пачек (`BullModule.registerFlowProducer` в `NotificationsWorkerModule`). */
export const NOTIFICATIONS_FANOUT_PRODUCER = 'notifications-fanout';

/**
 * Постановка задач-пачек получателей (`notifications.fanout`) в `notifications-intake`. Все пачки события — одной
 * атомарной операцией: `FlowProducer.addBulk` плоскими узлами без `children` — `MULTI` (все или ни одной);
 * `Queue.addBulk` — pipeline, обрыв мог бы оставить часть пачек (task §8.1 RC-F1). Существующий jobId BullMQ не
 * дублирует. `FlowProducer` не применяет `defaultJobOptions` очереди — опции передаются явно.
 */
@Injectable()
export class FanoutJobs {
  constructor(
    @InjectQueue(QUEUE.notificationsIntake) private readonly queue: Queue,
    @InjectFlowProducer(NOTIFICATIONS_FANOUT_PRODUCER) private readonly flow: FlowProducer,
  ) {}

  /** Пачки события уже поставлены: пачка `0-0` (есть при любой раскладке) в любом состоянии. */
  async started(eventId: string): Promise<boolean> {
    return (await this.queue.getJob(fanoutJobId(eventId, 0, 0))) !== undefined;
  }

  /** Все пачки одной операцией; возвращает их число. */
  async enqueue(chunks: readonly FanoutChunk[]): Promise<number> {
    await this.flow.addBulk(
      chunks.map((chunk) => ({
        name: NOTIFICATIONS_FANOUT_JOB,
        queueName: QUEUE.notificationsIntake,
        ...(this.queue.opts.prefix === undefined ? {} : { prefix: this.queue.opts.prefix }),
        data: chunk.data,
        opts: { ...this.queue.defaultJobOptions, jobId: chunk.jobId },
      })),
    );
    return chunks.length;
  }
}
