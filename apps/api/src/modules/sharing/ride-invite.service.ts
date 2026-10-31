import { Injectable } from '@nestjs/common';
import type { StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { CardRequests } from './card-requests';
import { InviteAddress } from './invite-address';
import { RIDE_INVITE_RENDER_JOB, type RideInviteJob } from './story-card.cache';
import { RideInviteInputs } from './ride-invite.inputs';

/**
 * Статус карточки-приглашения кофе-райда (ADR-0018): лимит чтения → факты райда (скрытый и неизвестный — 404, не
 * будущий — 409 `STORY_CARD_UNAVAILABLE`) → общий поток `CardRequests` (задача `ride-invite.render`).
 */
@Injectable()
export class RideInviteService {
  constructor(
    private readonly inputs: RideInviteInputs,
    private readonly requests: CardRequests,
    private readonly addresses: InviteAddress,
  ) {}

  async status(
    userId: string,
    rideId: string,
    template: StoryCardTemplate,
  ): Promise<StoryCardStatus> {
    await this.requests.consumeRead(userId);
    const address = await this.addresses.of(userId);
    const resolved = await this.inputs.resolve(userId, rideId, template, address);
    if (!resolved) throw domainError('STORY_CARD_UNAVAILABLE', 409);
    const data: RideInviteJob = { userId, rideId, template, hash: resolved.hash, address };
    return this.requests.status(userId, {
      name: RIDE_INVITE_RENDER_JOB,
      data,
      jobId: `ride-invite-${resolved.hash}`,
    });
  }
}
