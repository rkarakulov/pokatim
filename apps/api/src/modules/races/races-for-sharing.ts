import { Injectable } from '@nestjs/common';

import type { ChangedCursor, ChangedRow } from '../../changed-since';
import type { RaceOgFacts, RacesForSharing } from './races-for-sharing.port';
import { RacesRepository } from './races.repository';

/** Реализация порта `RacesForSharing` (OG-картинка): только `published` — отменённая страница видна, картинки нет. */
@Injectable()
export class RacesForSharingService implements RacesForSharing {
  constructor(private readonly repository: RacesRepository) {}

  async ogFacts(raceId: string): Promise<RaceOgFacts | null> {
    const race = await this.repository.findPublished(raceId);
    if (!race) return null;
    return {
      raceId: race._id,
      title: race.title,
      windowStartsAt: race.windowStartsAt,
      windowEndsAt: race.windowEndsAt,
      distanceKm: race.distanceKm,
      bikeClass: race.bikeClass,
      routeId: race.corridor?.routeId ?? null,
    };
  }

  ogChanged(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    return this.repository.changedForOg(after, limit);
  }
}
