import { Injectable } from '@nestjs/common';

import type { RidesForSocial, SocialRideFacts } from './rides-for-social.port';
import { ridePhase } from './rides.policy';
import { RidesRepository } from './rides.repository';

/** Реализация порта `RidesForSocial` («Свои»): фаза — `ridePhase`, участники — только `userId` в порядке записи. */
@Injectable()
export class RidesForSocialService implements RidesForSocial {
  constructor(private readonly repository: RidesRepository) {}

  async rideFacts(rideId: string, now: Date): Promise<SocialRideFacts | null> {
    const doc = await this.repository.findForSocial(rideId);
    if (!doc) return null;
    const [lon, lat] = doc.geo?.coordinates ?? [];
    return {
      rideId: doc._id,
      phase: ridePhase(doc, now),
      startsAt: doc.startsAt,
      organizerUserId: doc.organizerUserId,
      participantIds: doc.participants.map((participant) => participant.userId),
      preciseStart:
        doc.startPrecise === true && lon !== undefined && lat !== undefined ? [lon, lat] : null,
    };
  }
}
