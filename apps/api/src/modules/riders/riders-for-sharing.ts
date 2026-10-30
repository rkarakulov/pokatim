import { Inject, Injectable } from '@nestjs/common';

import { RIDER_PROFILES, type RiderProfileDirectory } from '../profile';
import { RIDER_RESULTS, type RiderResults } from '../results';
import type { RiderOgFacts, RidersForSharing } from './riders-for-sharing.port';
import { summarize } from './riders.policy';

/**
 * Реализация порта `RidersForSharing`: публичность — только `RIDER_PROFILES.findPublic`, статистика — строки
 * опубликованных протоколов и финиши через `RIDER_RESULTS` и одна сводка `summarize` (как публичный профиль).
 */
@Injectable()
export class RidersForSharingService implements RidersForSharing {
  constructor(
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
  ) {}

  async ogFacts(publicId: string): Promise<RiderOgFacts | null> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) return null;
    const [rows, finishes] = await Promise.all([
      this.results.publishedRows(rider.userId),
      this.results.publishedFinishes(rider.userId),
    ]);
    const summary = summarize(rows, finishes);
    return {
      publicId,
      races: summary.finishes,
      podiums: summary.podiums,
      bestPlace: summary.bestPlaces[0]?.place ?? null,
    };
  }
}
