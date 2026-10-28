import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitedDetails, StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';

import { domainError } from '../../error-messages';
import { QUEUE } from '../../queues';
import { STORY_CARD_POLICY } from './sharing.policy';
import { STORY_CARD_RENDER_JOB, StoryCardCache, type StoryCardJob } from './story-card.cache';
import { StoryCardInputs } from './story-card.inputs';

const rateLimited = (retryAfterSec: number) => {
  const details: RateLimitedDetails = { retryAfterSec };
  return domainError('RATE_LIMITED', 429, details);
};

/**
 * Статус карточки для сторис своего результата (story-cards): HTTP читает кэш Redis и ставит задачу `story-card`;
 * рендер — только worker. Лимит чтения → входы (404/409) → готовый токен → отказ (один раз) → постановка (NX, лимит
 * рендера списывается только при захвате).
 */
@Injectable()
export class StoryCardService {
  constructor(
    private readonly inputs: StoryCardInputs,
    private readonly cache: StoryCardCache,
    private readonly rateLimiter: RateLimiter,
    @InjectQueue(QUEUE.storyCard) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async status(
    userId: string,
    raceId: string,
    template: StoryCardTemplate,
  ): Promise<StoryCardStatus> {
    const read = await this.rateLimiter.consume(
      `story-card-read:${userId}`,
      STORY_CARD_POLICY.readLimit,
      this.clock.now(),
    );
    if (!read.allowed) throw rateLimited(read.retryAfterSec);

    const resolved = await this.inputs.resolve(userId, raceId, template);
    if (!resolved) throw domainError('STORY_CARD_UNAVAILABLE', 409);
    const { hash } = resolved;

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
      const data: StoryCardJob = { userId, raceId, template, hash };
      try {
        await this.queue.add(STORY_CARD_RENDER_JOB, data, {
          // вторая линия дедупликации; `:` в jobId BullMQ не допускает
          jobId: `story-card-${hash}`,
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
