import { Inject, Injectable } from '@nestjs/common';
import type { RiderSocial, SocialConnectionRow, SocialConnections } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { type PublicRiderRecord, RIDER_PROFILES, type RiderProfileDirectory } from '../profile';
import { RIDES_FOR_SOCIAL, type RidesForSocial } from '../rides';
import { SocialConnectionsService } from './connections.service';
import { socialBlocked } from './social.policy';

const SELF: RiderSocial = {
  self: true,
  connected: false,
  together: { rideCount: 0, lastRideAt: null },
  going: null,
};

/**
 * «Свои» на профиле райдера (P3, K6, ADR-0027 п. 3): состояние вошедшего зрителя к публичному профилю, «В свои» /
 * «Убрать» и список «Свои». `publicId` → райдер — только `RIDER_PROFILES.findPublic` (неизвестный и непубличный —
 * одинаковый `404`); связи и лимит K11 — `SocialConnectionsService`; карточка «Идёт» — порт `rides`. Ответы — явным
 * списком полей, без `userId`.
 */
@Injectable()
export class RiderSocialService {
  constructor(
    private readonly connections: SocialConnectionsService,
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET riders/:publicId/social`: «Идёт» — только если зритель у райдера в «своих» (связь не убрана, K6). */
  async view(viewerId: string, publicId: string): Promise<RiderSocial> {
    return this.viewOf(viewerId, await this.target(publicId));
  }

  /**
   * `PUT riders/:publicId/social/connection`: `findPublic` (нет — `404`) → себе — `409 self` (и для `false`: иначе
   * надгробие самому себе) → `true` — `addManual` (лимит K11 внутри первым), `false` — тихое `remove`.
   */
  async setConnection(
    viewerId: string,
    publicId: string,
    connected: boolean,
  ): Promise<RiderSocial> {
    const target = await this.target(publicId);
    if (target.userId === viewerId) throw socialBlocked('self');
    if (connected) await this.connections.addManual(viewerId, target.userId);
    else await this.connections.remove(viewerId, target.userId);
    return this.viewOf(viewerId, target);
  }

  /** `GET social/connections`: строки без `publicId` (до бэкфилла) не попадают ни в список, ни в счётчик. */
  async connectionsOf(ownerId: string): Promise<SocialConnections> {
    const items = (await this.connections.listOf(ownerId)).flatMap((row): SocialConnectionRow[] =>
      row.card.publicId === null
        ? []
        : [
            {
              publicId: row.card.publicId,
              name: row.card.name,
              avatar: row.card.avatarId ? { id: row.card.avatarId } : null,
              rideCount: row.rideCount,
              lastRideAt: row.lastRideAt?.toISOString() ?? null,
              sources: row.sources,
            },
          ],
    );
    return { items, count: items.length };
  }

  private async target(publicId: string): Promise<PublicRiderRecord> {
    const target = await this.profiles.findPublic(publicId);
    if (!target) throw domainError('NOT_FOUND', 404);
    return target;
  }

  private async viewOf(viewerId: string, target: PublicRiderRecord): Promise<RiderSocial> {
    if (target.userId === viewerId) return SELF;
    const pair = await this.connections.pairState(viewerId, target.userId);
    const going = pair.inTheirs
      ? await this.rides.nextRideCard(target.userId, viewerId, this.clock.now())
      : null;
    return {
      self: false,
      connected: pair.connected,
      together: {
        rideCount: pair.together.rideCount,
        lastRideAt: pair.together.lastRideAt?.toISOString() ?? null,
      },
      going,
    };
  }
}
