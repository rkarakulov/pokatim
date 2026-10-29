import { Inject, Injectable, Logger } from '@nestjs/common';

import { RACE_REGISTRY, type RaceRegistry } from '../races';
import { unrankedOf } from './results.policy';
import {
  type RiderFinishRow,
  RIDER_RESULTS_MAX_ROWS,
  type RiderProtocolRow,
  type RiderRaceInfo,
  type RiderResults,
} from './rider-results.port';
import { ResultsRepository } from './results.repository';

/**
 * Реализация порта `RiderResults` (rider-profile): строки райдера по индексу `race_protocol_rows_user_idx` → текущие
 * ревизии гонок одним `aggregate` (`currentRevisions`, как у `standings`) → только строки текущей ревизии.
 */
@Injectable()
export class RiderResultsService implements RiderResults {
  private readonly logger = new Logger(RiderResultsService.name);

  constructor(
    private readonly repository: ResultsRepository,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
  ) {}

  async publishedRows(userId: string): Promise<RiderProtocolRow[]> {
    const rows = await this.repository.protocolRowsOfUser(userId, RIDER_RESULTS_MAX_ROWS);
    if (rows.length === RIDER_RESULTS_MAX_ROWS) {
      this.logger.warn(`riders.rows_truncated uid=${userId} limit=${RIDER_RESULTS_MAX_ROWS}`);
    }
    const current = await this.repository.currentRevisions([
      ...new Set(rows.map((row) => row.raceId)),
    ]);
    return rows
      .filter((row) => current.get(row.raceId) === row.revision)
      .map((row) => ({
        raceId: row.raceId,
        place: row.place,
        tied: row.tied,
        status: row.status,
        groupKey: row.groupKey ?? 'overall',
        elapsedSec: row.elapsedSec,
        startedAt: row.startedAt,
      }));
  }

  async publishedFinishes(userId: string): Promise<RiderFinishRow[]> {
    const entries = await this.repository.finisherEntriesOfUser(userId, RIDER_RESULTS_MAX_ROWS);
    if (entries.length === RIDER_RESULTS_MAX_ROWS) {
      this.logger.warn(`riders.finishes_truncated uid=${userId} limit=${RIDER_RESULTS_MAX_ROWS}`);
    }
    // протокол опубликован ⇔ у гонки есть ревизия (журнал пересчётов)
    const published = await this.repository.currentRevisions([
      ...new Set(entries.map((entry) => entry.raceId)),
    ]);
    return entries.flatMap((entry) => {
      const unranked = unrankedOf(entry);
      if (!entry.best || unranked === null || !published.has(entry.raceId)) return [];
      return [
        {
          raceId: entry.raceId,
          groupKey: entry.groupKey,
          elapsedSec: entry.best.elapsedSec,
          startedAt: entry.best.startedAt,
          unranked,
        },
      ];
    });
  }

  async racesOf(raceIds: readonly string[]): Promise<Map<string, RiderRaceInfo>> {
    const found = new Map<string, RiderRaceInfo>();
    for (const id of new Set(raceIds)) {
      const race = await this.races.get(id);
      if (race) found.set(id, { title: race.title, windowStartsAt: race.windowStartsAt });
    }
    return found;
  }
}
