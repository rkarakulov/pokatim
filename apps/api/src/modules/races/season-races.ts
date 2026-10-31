import { Injectable } from '@nestjs/common';

import type { PanelPrincipal } from '../panel';
import { ownScope } from './races.policy';
import { RacesRepository } from './races.repository';
import type { FinishedSeason, SeasonRaceForStandings, SeasonRaces } from './season-races.port';

/** Реализация порта `SeasonRaces` (race-results-08): читает `races` и `seasons` только через `RacesRepository`. */
@Injectable()
export class SeasonRacesService implements SeasonRaces {
  constructor(private readonly repository: RacesRepository) {}

  async protocolRaces(seasonIds?: readonly string[]): Promise<SeasonRaceForStandings[]> {
    const docs = await this.repository.listProtocolRaces(seasonIds);
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

  async protocolRaceSeason(raceId: string): Promise<string | undefined> {
    return this.repository.protocolRaceSeason(raceId);
  }

  async finishedSeasons(now: Date): Promise<FinishedSeason[]> {
    const docs = await this.repository.seasonsEndedBy(now);
    return docs.map((doc) => ({
      id: doc._id,
      name: doc.name,
      endsOn: doc.endsOn,
      endsBefore: doc.endsBefore,
    }));
  }

  async awaitingProtocol(seasonIds: readonly string[]): Promise<Set<string>> {
    return new Set(
      seasonIds.length > 0 ? await this.repository.seasonsAwaitingProtocol(seasonIds) : [],
    );
  }

  async lastCancelledAt(seasonIds: readonly string[]): Promise<Map<string, Date>> {
    return seasonIds.length > 0 ? this.repository.lastCancelledAt(seasonIds) : new Map();
  }

  async seasonExists(seasonId: string): Promise<boolean> {
    return (await this.repository.findSeason(seasonId)) !== undefined;
  }

  seesAllRaces(principal: Pick<PanelPrincipal, 'permissions'>): boolean {
    return !ownScope(principal);
  }
}
