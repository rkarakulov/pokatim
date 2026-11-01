import { Inject, Injectable } from '@nestjs/common';
import type { RideCard } from '@pokatim/contracts';

import { RIDE_ROUTES, type RideRoutes } from '../routes';
import { RideReportsRepository } from './ride-reports.repository';
import { lookupRoutes, rideCardOf } from './rides-feed.service';
import type { ChangedCursor } from '../../changed-since';
import {
  type RidesForSocial,
  SOCIAL_PARTICIPANT_RIDES_MAX,
  type SocialRideFacts,
  type SocialStartedRide,
  type SocialUpcomingRide,
} from './rides-for-social.port';
import type { RideDoc } from './rides.collection';
import { ridePhase } from './rides.policy';
import { RidesRepository } from './rides.repository';

type SocialFactsDoc = Pick<
  RideDoc,
  '_id' | 'status' | 'startsAt' | 'organizerUserId' | 'participants' | 'geo' | 'startPrecise'
>;

/** Факты райда для `social`: фаза — `ridePhase`, участники — `userId` по порядку, точка — при `startPrecise`. */
function socialFactsOf(doc: SocialFactsDoc, now: Date): SocialRideFacts {
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
    return doc ? socialFactsOf(doc, now) : null;
  }

  async ridesOfParticipant(
    userId: string,
    from: Date,
    to: Date,
    now: Date,
  ): Promise<SocialRideFacts[]> {
    const docs = await this.repository.participantRidesBetween(
      userId,
      from,
      to,
      SOCIAL_PARTICIPANT_RIDES_MAX,
    );
    return docs.map((doc) => socialFactsOf(doc, now));
  }

  async startedRidesWithin(
    after: ChangedCursor,
    until: Date,
    limit: number,
  ): Promise<{ rides: SocialStartedRide[]; next: ChangedCursor | null }> {
    const docs = await this.repository.startedWithin(after, until, limit);
    const last = docs.at(-1);
    return {
      rides: docs.map((doc) => ({
        rideId: doc._id,
        startsAt: doc.startsAt,
        participantIds: doc.participants.map((participant) => participant.userId),
      })),
      next: last ? { at: last.startsAt, id: last._id } : null,
    };
  }

  async upcomingWithRiders(
    riderIds: readonly string[],
    viewerId: string,
    now: Date,
    until: Date,
    limit: number,
  ): Promise<SocialUpcomingRide[]> {
    if (riderIds.length === 0) return [];
    const docs = await this.repository.upcomingWithParticipants(riderIds, now, until, limit);
    if (docs.length === 0) return [];
    const [routes, reported] = await Promise.all([
      lookupRoutes(this.rideRoutes, docs, viewerId),
      this.reports.reportedRideIds(
        viewerId,
        docs.map((doc) => doc._id),
      ),
    ]);
    return docs.map((doc) => ({
      card: rideCardOf(doc, viewerId, now, routes, reported.has(doc._id)),
      participantIds: doc.participants.map((participant) => participant.userId),
    }));
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
