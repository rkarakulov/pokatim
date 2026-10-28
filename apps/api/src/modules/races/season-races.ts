import { Injectable } from '@nestjs/common';

import type { PanelPrincipal } from '../panel';
import { ownScope } from './races.policy';
import { RacesRepository } from './races.repository';
import type { SeasonRaceForStandings, SeasonRaces } from './season-races.port';

/** Реализация порта `SeasonRaces` (race-results-08): читает `races` и `seasons` только через `RacesRepository`. */
@Injectable()
export class SeasonRacesService implements SeasonRaces {
  constructor(private readonly repository: RacesRepository) {}

  async protocolRaces(seasonId?: string): Promise<SeasonRaceForStandings[]> {
    const docs = await this.repository.listProtocolRaces(seasonId);
    return docs.flatMap((doc) =>
      doc.seasonId
        ? [
            {
              id: doc._id,
              seasonId: doc.seasonId,
              bikeClass: doc.bikeClass,
              groupScheme: doc.groupScheme ?? (doc.lockedAt ? 'overall' : 'gender_age'),
              title: doc.title,
              windowEndsAt: doc.windowEndsAt,
            },
          ]
        : [],
    );
  }

  async seasonExists(seasonId: string): Promise<boolean> {
    return (await this.repository.findSeason(seasonId)) !== undefined;
  }

  seesAllRaces(principal: Pick<PanelPrincipal, 'permissions'>): boolean {
    return !ownScope(principal);
  }
}
