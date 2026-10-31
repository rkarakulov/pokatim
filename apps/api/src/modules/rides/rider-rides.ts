import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { ChangedCursor, RiderChanges } from '../../changed-since';
import { RIDER_RIDES_MAX_ROWS, type RiderRideFact, type RiderRides } from './rider-rides.port';
import { RidesRepository } from './rides.repository';

/** Реализация порта `RiderRides` (achievements): условия R8 — только в `RidesRepository.pastFactsOf`. */
@Injectable()
export class RiderRidesService implements RiderRides {
  private readonly logger = new Logger(RiderRidesService.name);

  constructor(
    private readonly repository: RidesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pastOf(userId: string): Promise<RiderRideFact[]> {
    const docs = await this.repository.pastFactsOf(userId, this.clock.now(), RIDER_RIDES_MAX_ROWS);
    if (docs.length === RIDER_RIDES_MAX_ROWS) {
      this.logger.warn(`achievements.rides_truncated uid=${userId} limit=${RIDER_RIDES_MAX_ROWS}`);
    }
    return docs.map((doc) => ({
      rideId: doc._id,
      title: doc.title,
      startsAt: doc.startsAt,
      organizer: doc.organizerUserId === userId,
      goingCount: doc.goingCount,
    }));
  }

  async startedRidersAfter(
    after: ChangedCursor,
    until: Date,
    limit: number,
  ): Promise<RiderChanges> {
    const docs = await this.repository.startedWithin(after, until, limit);
    const last = docs.at(-1);
    return {
      userIds: [...new Set(docs.flatMap((doc) => doc.participants.map((p) => p.userId)))],
      next: last ? { at: last.startsAt, id: last._id } : null,
      full: docs.length === limit,
    };
  }
}
