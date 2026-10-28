import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitedDetails, StoryCardStatus } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';

import { domainError } from '../../error-messages';
import { QUEUE } from '../../queues';
import { STORY_CARD_POLICY } from './sharing.policy';
import { StoryCardCache } from './story-card.cache';

const rateLimited = (retryAfterSec: number) => {
  const details: RateLimitedDetails = { retryAfterSec };
  return domainError('RATE_LIMITED', 429, details);
};

/** Задача рендера: имя в очереди `story-card`, данные (id и хэш — данные карточки worker перечитывает сам), jobId. */
export interface CardRenderJob {
  name: string;
  data: Record<string, unknown> & { hash: string };
  /** вторая линия дедупликации; `:` в jobId BullMQ не допускает */
  jobId: string;
}

/**
 * Общий поток статуса карточек (сторис гонки, приглашение райда; ADR-0018): HTTP читает кэш Redis и ставит задачу в
 * очередь `story-card`, рендер — только worker. Лимиты пользователя общие для всех карточек: чтение — до входов,
 * рендер — только при захвате ключа постановки (NX). Порядок: готовый токен → отказ (один раз) → постановка.
 */
@Injectable()
export class CardRequests {
  constructor(
    private readonly cache: StoryCardCache,
    private readonly rateLimiter: RateLimiter,
    @InjectQueue(QUEUE.storyCard) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Лимит чтения статуса (`story-card-read:<uid>`) — первой проверкой, до входов. */
  async consumeRead(userId: string): Promise<void> {
    const read = await this.rateLimiter.consume(
      `story-card-read:${userId}`,
      STORY_CARD_POLICY.readLimit,
      this.clock.now(),
    );
    if (!read.allowed) throw rateLimited(read.retryAfterSec);
  }

  async status(userId: string, job: CardRenderJob): Promise<StoryCardStatus> {
    const { hash } = job.data;
    const token = await this.cache.readyToken(hash);
    if (token) return { status: 'ready', token };
    if (await this.cache.takeFailed(hash)) return { status: 'failed' };

    if (await this.cache.claim(hash)) {
      const render = await this.rateLimiter.consume(
        `story-card-render:${userId}`,
        STORY_CARD_POLICY.renderLimit,
        this.clock.now(),
      );
      if (!render.allowed) {
        await this.cache.release(hash);
        throw rateLimited(render.retryAfterSec);
      }
      try {
        await this.queue.add(job.name, job.data, {
          jobId: job.jobId,
          attempts: STORY_CARD_POLICY.jobAttempts,
          backoff: { type: 'exponential', delay: STORY_CARD_POLICY.jobBackoffMs },
          removeOnComplete: true,
          removeOnFail: true,
        });
      } catch (error) {
        await this.cache.release(hash);
        throw error;
      }
    }
    return { status: 'pending' };
  }
}
