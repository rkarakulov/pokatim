import { Injectable } from '@nestjs/common';
import type { StoryCardStatus, StoryCardTemplate } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { CardRequests } from './card-requests';
import { RouteCardInputs } from './route-card.inputs';
import { ROUTE_CARD_RENDER_JOB, type RouteCardJob } from './story-card.cache';

/**
 * Статус карточки маршрута каталога (ADR-0018): лимит чтения → факты маршрута (не в каталоге — заявка, отклонён,
 * скрыт, снят, личный, неизвестный — один ответ 404) → общий поток `CardRequests` (задача `route-card.render`).
 */
@Injectable()
export class RouteCardService {
  constructor(
    private readonly inputs: RouteCardInputs,
    private readonly requests: CardRequests,
  ) {}

  async status(
    userId: string,
    routeId: string,
    template: StoryCardTemplate,
  ): Promise<StoryCardStatus> {
    await this.requests.consumeRead(userId);
    const resolved = await this.inputs.resolve(userId, routeId, template);
    if (!resolved) throw domainError('NOT_FOUND', 404);
    const data: RouteCardJob = { userId, routeId, template, hash: resolved.hash };
    return this.requests.status(userId, {
      name: ROUTE_CARD_RENDER_JOB,
      data,
      jobId: `route-card-${resolved.hash}`,
    });
  }
}
