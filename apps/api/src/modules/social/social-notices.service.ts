import { Injectable } from '@nestjs/common';

import { ConnectionsRepository } from './connections.repository';
import { ReactionsRepository } from './reactions.repository';
import type { SocialNotices, SocialReactionNotice } from './social-notices.port';

/** Реализация `SOCIAL_NOTICES` (P7): только чтение, по существующим индексам `social_reactions` и `rider_connections`. */
@Injectable()
export class SocialNoticesService implements SocialNotices {
  constructor(
    private readonly reactions: ReactionsRepository,
    private readonly connections: ConnectionsRepository,
  ) {}

  async reaction(reactionId: string): Promise<SocialReactionNotice | null> {
    const doc = await this.reactions.findById(reactionId);
    if (!doc) return null;
    const { kind, actorId, recipientId, targetType, targetId } = doc;
    return { kind, actorId, recipientId, targetType, targetId };
  }

  async goingAudience(riderId: string): Promise<string[]> {
    const owners = await this.connections.ownerIdsOf(riderId);
    if (owners.length === 0) return [];
    const mutual = await this.connections.otherIdsAmong(riderId, owners);
    return owners.filter((ownerId) => mutual.has(ownerId));
  }

  connected(ownerId: string, otherId: string): Promise<boolean> {
    return this.connections.isConnected({ ownerId, otherId });
  }
}
