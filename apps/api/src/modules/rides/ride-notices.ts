import { Injectable } from '@nestjs/common';

import type { RideNotice, RideNotices } from './ride-notices.port';
import { RideReportsRepository } from './ride-reports.repository';
import { RidesRepository } from './rides.repository';

/** Реализация порта `RideNotices` (notifications): проекции `RidesRepository` и `RideReportsRepository`. */
@Injectable()
export class RideNoticesService implements RideNotices {
  constructor(
    private readonly rides: RidesRepository,
    private readonly reports: RideReportsRepository,
  ) {}

  async ride(rideId: string): Promise<RideNotice | null> {
    const doc = await this.rides.findForNotice(rideId);
    if (!doc) return null;
    return {
      id: doc._id,
      title: doc.title,
      startsAt: doc.startsAt,
      status: doc.status,
      organizerUserId: doc.organizerUserId,
      goingCount: doc.goingCount,
      participants: doc.participants
        .filter((participant) => participant.userId !== doc.organizerUserId)
        .map(({ userId, seq }) => ({ userId, seq: seq ?? 0 })),
    };
  }

  resolvedReporters(rideId: string, resolvedAt: Date): Promise<string[]> {
    return this.reports.reportersResolvedAt(rideId, resolvedAt);
  }
}
