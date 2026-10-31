import { Injectable } from '@nestjs/common';
import {
  type AchievementCode,
  type AchievementStoryCardQuery,
  isSeasonalCode,
  type StoryCardStatus,
  type ValidationErrorDetails,
} from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { cardRef } from '../achievements';
import { AchievementCardInputs } from './achievement-card.inputs';
import { CardRequests } from './card-requests';
import { InviteAddress } from './invite-address';
import { ACHIEVEMENT_CARD_RENDER_JOB, type AchievementCardJob } from './story-card.cache';

/**
 * Статус карточки своего достижения (ADR-0018): сверка «код ↔ `seasonId`» (400 до лимита, C2) → лимит чтения → входы
 * (не получено или отозвано — 409 `STORY_CARD_UNAVAILABLE`) → общий поток `CardRequests` (задача
 * `achievement-card.render`).
 */
@Injectable()
export class AchievementCardService {
  constructor(
    private readonly inputs: AchievementCardInputs,
    private readonly requests: CardRequests,
    private readonly addresses: InviteAddress,
  ) {}

  async status(
    userId: string,
    code: AchievementCode,
    { template, seasonId }: AchievementStoryCardQuery,
  ): Promise<StoryCardStatus> {
    const ref = cardRef(code, seasonId ?? null);
    if (!ref) {
      // сезонный без сезона — REQUIRED, несезонный с сезоном — INVALID (RC-4)
      const details: ValidationErrorDetails = {
        fields: [{ path: 'seasonId', code: isSeasonalCode(code) ? 'REQUIRED' : 'INVALID' }],
      };
      throw domainError('VALIDATION_FAILED', 400, details);
    }
    await this.requests.consumeRead(userId);
    const address = await this.addresses.of(userId);
    const resolved = await this.inputs.resolve(userId, ref, template, address);
    if (!resolved) throw domainError('STORY_CARD_UNAVAILABLE', 409);
    const data: AchievementCardJob = {
      userId,
      code,
      seasonId: ref.seasonId,
      template,
      hash: resolved.hash,
      address,
    };
    return this.requests.status(userId, {
      name: ACHIEVEMENT_CARD_RENDER_JOB,
      data,
      jobId: `achievement-card-${resolved.hash}`,
    });
  }
}
