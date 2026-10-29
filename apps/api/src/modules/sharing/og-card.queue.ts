import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { OG_CARD_RENDER_JOB, OgCardCache, type OgCardJob } from './og-card.cache';
import { OG_CARD_POLICY } from './sharing.policy';

/**
 * Постановка рендера OG-картинки в очередь `story-card` — один код для HTTP (самолечение) и `og.sync` (пререндер):
 * ключ постановки NX по хэшу, jobId `og-card-<hash>` — вторая линия дедупликации; `priority` — задачи сторис и
 * приглашений (без приоритета) берутся раньше (BullMQ: список ожидания до приоритетных).
 */
@Injectable()
export class OgCardQueue {
  constructor(
    private readonly cache: OgCardCache,
    @InjectQueue(QUEUE.storyCard) private readonly queue: Queue,
  ) {}

  /** `true` — задача поставлена; `false` — уже поставлена (ключ занят). Сбой очереди — ключ снят, ошибка выше. */
  async enqueue(job: OgCardJob): Promise<boolean> {
    if (!(await this.cache.claim(job.hash))) return false;
    try {
      await this.queue.add(OG_CARD_RENDER_JOB, job, {
        jobId: `og-card-${job.hash}`,
        priority: OG_CARD_POLICY.jobPriority,
        attempts: OG_CARD_POLICY.jobAttempts,
        backoff: { type: 'exponential', delay: OG_CARD_POLICY.jobBackoffMs },
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (error) {
      await this.cache.release(job.hash);
      throw error;
    }
    return true;
  }
}
