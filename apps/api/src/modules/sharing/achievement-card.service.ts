import { Injectable } from '@nestjs/common';
import type { AchievementCode, StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { AchievementCardInputs } from './achievement-card.inputs';
import { CardRequests } from './card-requests';
import { ACHIEVEMENT_CARD_RENDER_JOB, type AchievementCardJob } from './story-card.cache';

/**
 * Статус карточки своего достижения (ADR-0018): лимит чтения → входы (не получено или отозвано — 409
 * `STORY_CARD_UNAVAILABLE`) → общий поток `CardRequests` (задача `achievement-card.render`).
 */
@Injectable()
export class AchievementCardService {
  constructor(
    private readonly inputs: AchievementCardInputs,
    private readonly requests: CardRequests,
  ) {}

  async status(
    userId: string,
    code: AchievementCode,
    template: StoryCardTemplate,
  ): Promise<StoryCardStatus> {
    await this.requests.consumeRead(userId);
    const resolved = await this.inputs.resolve(userId, code, template);
    if (!resolved) throw domainError('STORY_CARD_UNAVAILABLE', 409);
    const data: AchievementCardJob = { userId, code, template, hash: resolved.hash };
    return this.requests.status(userId, {
      name: ACHIEVEMENT_CARD_RENDER_JOB,
      data,
      jobId: `achievement-card-${resolved.hash}`,
    });
  }
}
