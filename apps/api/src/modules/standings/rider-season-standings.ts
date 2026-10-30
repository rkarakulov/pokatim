import { Inject, Injectable } from '@nestjs/common';

import { SEASON_RACES, type SeasonRaces } from '../races';
import type {
  RiderSeasonOutcome,
  RiderSeasonRow,
  RiderSeasonStandings,
} from './rider-season-standings.port';
import { StandingsSource } from './standings-source';
import { StandingsRepository } from './standings.repository';

/**
 * Реализация `RIDER_SEASON_STANDINGS` (achievements-seasonal, 7.2): завершённые сезоны — порт `SEASON_RACES`; строки и
 * заголовки снимка — одна snapshot-сессия; актуальность — тот же отпечаток `StandingsSource`, что у регламента и сводки
 * панели (источник читается **после** снимка: пересчёт между чтениями даёт `pending`). Без записи.
 */
@Injectable()
export class RiderSeasonStandingsService implements RiderSeasonStandings {
  constructor(
    @Inject(SEASON_RACES) private readonly seasons: SeasonRaces,
    private readonly repository: StandingsRepository,
    private readonly source: StandingsSource,
  ) {}

  async outcomesOf(
    userId: string,
    alsoSeasonIds: readonly string[],
    now: Date,
  ): Promise<RiderSeasonOutcome[]> {
    const finished = await this.seasons.finishedSeasons(now);
    if (finished.length === 0) return [];
    const finishedIds = new Set(finished.map((season) => season.id));
    const snapshot = await this.repository.withSnapshot(async (session) => {
      const rows = await this.repository.rowsOfUserIn([...finishedIds], userId, session);
      const relevant = new Set([
        ...rows.map((row) => row.seasonId),
        ...alsoSeasonIds.filter((id) => finishedIds.has(id)),
      ]);
      if (relevant.size === 0) return null;
      return { rows, relevant, headers: await this.repository.headersOf([...relevant], session) };
    });
    if (!snapshot) return [];
    const relevantIds = [...snapshot.relevant];
    const [awaiting, sources] = await Promise.all([
      this.seasons.awaitingProtocol(relevantIds),
      this.source.load(relevantIds),
    ]);
    const outcomes: RiderSeasonOutcome[] = [];
    for (const season of finished) {
      if (!snapshot.relevant.has(season.id)) continue;
      const fingerprint = snapshot.headers.get(season.id)?.fingerprint;
      const final =
        !awaiting.has(season.id) &&
        fingerprint !== undefined &&
        sources.get(season.id)?.fingerprint === fingerprint;
      if (!final) {
        outcomes.push({ seasonId: season.id, status: 'pending', title: season.name });
        continue;
      }
      outcomes.push({
        seasonId: season.id,
        status: 'final',
        title: season.name,
        endsOn: season.endsOn,
        endsBefore: season.endsBefore,
        rows: snapshot.rows
          .filter((row) => row.seasonId === season.id)
          .map((row): RiderSeasonRow => ({
            bikeClass: row.bikeClass,
            groupKey: row.groupKey,
            place: row.place,
            tied: row.tied,
            placedRaces: row.cells.filter((cell) => cell.outcome === 'placed').length,
          })),
      });
    }
    return outcomes;
  }
}
