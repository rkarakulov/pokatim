import { Injectable } from '@nestjs/common';

import type { ResultsForStandings, StandingsSourceRow } from './results-for-standings.port';
import { ResultsRepository } from './results.repository';

/** Реализация порта `ResultsForStandings` (race-results-08): только чтения через `ResultsRepository`. */
@Injectable()
export class ResultsForStandingsService implements ResultsForStandings {
  constructor(private readonly repository: ResultsRepository) {}

  currentRevisions(raceIds: readonly string[]): Promise<Map<string, number>> {
    return this.repository.currentRevisions(raceIds);
  }

  async protocolRows(raceId: string, revision: number): Promise<StandingsSourceRow[]> {
    const rows = await this.repository.standingsRows(raceId, revision);
    return rows.map((row) => ({
      userId: row.userId,
      place: row.place,
      tied: row.tied,
      status: row.status,
      groupKey: row.groupKey ?? 'overall',
    }));
  }
}
