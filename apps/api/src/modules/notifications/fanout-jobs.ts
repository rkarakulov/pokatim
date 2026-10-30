import { InjectFlowProducer, InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { FlowProducer, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import type { FanoutChunk } from './notification-fanout';
import { NOTIFICATIONS_FANOUT_JOB } from './notifications.events';

/** Имя `FlowProducer` постановки пачек (`BullModule.registerFlowProducer` в `NotificationsWorkerModule`). */
export const NOTIFICATIONS_FANOUT_PRODUCER = 'notifications-fanout';

/**
 * Постановка задач-пачек получателей (`notifications.fanout`) в `notifications-intake` по плану раскладки. Одна операция
 * `FlowProducer.addBulk` плоскими узлами без `children` — `MULTI` (`Queue.addBulk` — pipeline). `MULTI` не гарантирует
 * успеха команд: `addBulk` молча пропускает ошибку отдельной команды (OOM Redis при `noeviction`), поэтому после
 * постановки каждый jobId плана проверяется в очереди; недостающие ставятся ещё раз, всё ещё нет — исключение (ретрай
 * intake дотянет по сохранённому плану). Существующий jobId BullMQ не дублирует. `FlowProducer` не применяет
 * `defaultJobOptions` очереди — опции передаются явно.
 */
@Injectable()
export class FanoutJobs {
  constructor(
    @InjectQueue(QUEUE.notificationsIntake) private readonly queue: Queue,
    @InjectFlowProducer(NOTIFICATIONS_FANOUT_PRODUCER) private readonly flow: FlowProducer,
  ) {}

  /** Все пачки плана в очереди (идемпотентно); возвращает их число. */
  async enqueue(chunks: readonly FanoutChunk[]): Promise<number> {
    await this.add(chunks);
    let missing = await this.missing(chunks);
    if (missing.length > 0) {
      await this.add(missing);
      missing = await this.missing(missing);
    }
    if (missing.length > 0) {
      throw new Error(
        `notifications.fanout_enqueue_failed missing=${missing.length} of=${chunks.length}`,
      );
    }
    return chunks.length;
  }

  private async add(chunks: readonly FanoutChunk[]): Promise<void> {
    await this.flow.addBulk(
      chunks.map((chunk) => ({
        name: NOTIFICATIONS_FANOUT_JOB,
        queueName: QUEUE.notificationsIntake,
        ...(this.queue.opts.prefix === undefined ? {} : { prefix: this.queue.opts.prefix }),
        data: chunk.data,
        opts: { ...this.queue.defaultJobOptions, jobId: chunk.jobId },
      })),
    );
  }

  private async missing(chunks: readonly FanoutChunk[]): Promise<FanoutChunk[]> {
    const found = await Promise.all(chunks.map((chunk) => this.queue.getJob(chunk.jobId)));
    return chunks.filter((_, i) => found[i] === undefined);
  }
}
