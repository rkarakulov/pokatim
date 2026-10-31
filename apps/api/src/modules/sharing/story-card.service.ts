import { Injectable } from '@nestjs/common';
import type { StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { CardRequests } from './card-requests';
import { InviteAddress } from './invite-address';
import { STORY_CARD_RENDER_JOB, type StoryCardJob } from './story-card.cache';
import { StoryCardInputs } from './story-card.inputs';

/**
 * Статус карточки для сторис своего результата (story-cards): лимит чтения → входы (404/409) → общий поток
 * `CardRequests` (готовый токен, отказ, постановка задачи `story-card.render`).
 */
@Injectable()
export class StoryCardService {
  constructor(
    private readonly inputs: StoryCardInputs,
    private readonly requests: CardRequests,
    private readonly addresses: InviteAddress,
  ) {}

  async status(
    userId: string,
    raceId: string,
    template: StoryCardTemplate,
  ): Promise<StoryCardStatus> {
    await this.requests.consumeRead(userId);
    const address = await this.addresses.of(userId);
    const resolved = await this.inputs.resolve(userId, raceId, template, address);
    if (!resolved) throw domainError('STORY_CARD_UNAVAILABLE', 409);
    const data: StoryCardJob = { userId, raceId, template, hash: resolved.hash, address };
    return this.requests.status(userId, {
      name: STORY_CARD_RENDER_JOB,
      data,
      jobId: `story-card-${resolved.hash}`,
    });
  }
}
