import { Inject, Injectable } from '@nestjs/common';
import type { RideCard } from '@pokatim/contracts';

import { RIDE_ROUTES, type RideRoutes } from '../routes';
import { RideReportsRepository } from './ride-reports.repository';
import { lookupRoutes, rideCardOf } from './rides-feed.service';
import type { RidesForSocial, SocialRideFacts } from './rides-for-social.port';
import { ridePhase } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Реализация порта `RidesForSocial` («Свои»): фаза — `ridePhase`, участники — только `userId` в порядке записи;
 * карточка «Идёт» — `rideCardOf`, как в ленте (маршрут и жалоба — для этого зрителя).
 */
@Injectable()
export class RidesForSocialService implements RidesForSocial {
  constructor(
    private readonly repository: RidesRepository,
    private readonly reports: RideReportsRepository,
    @Inject(RIDE_ROUTES) private readonly rideRoutes: RideRoutes,
  ) {}

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

  async nextRideCard(riderId: string, viewerId: string, now: Date): Promise<RideCard | null> {
    const doc = await this.repository.nextOfRider(riderId, viewerId, now);
    if (!doc) return null;
    const [routes, reported] = await Promise.all([
      lookupRoutes(this.rideRoutes, [doc], viewerId),
      this.reports.reportedRideIds(viewerId, [doc._id]),
    ]);
    return rideCardOf(doc, viewerId, now, routes, reported.has(doc._id));
  }
}
