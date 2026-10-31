import { Inject, Injectable, Logger } from '@nestjs/common';

import { SEASON_RACES, type SeasonRaceForStandings, type SeasonRaces } from '../races';
import { RESULTS_FOR_STANDINGS, type ResultsForStandings } from '../results';
import { sourceFingerprint, sourceVersion } from './standings.policy';

export type SourceRace = SeasonRaceForStandings & { revision: number };

/** Источник снимка сезона: гонки с протоколом и их текущие ревизии, отпечаток и версия. */
export interface SeasonSource {
  races: SourceRace[];
  fingerprint: string;
  sourceVersion: number;
}

/**
 * Источник рейтинга сезона (race-results-08, RC-13): гонки с опубликованным протоколом (порт `races`) и текущие
 * ревизии (порт `results`, один `aggregate`). Им же пользуются сводка панели (RC-14) — «ждёт пересчёта» — и порт
 * `RIDER_SEASON_STANDINGS` (актуальность итогового снимка).
 */
@Injectable()
export class StandingsSource {
  private readonly logger = new Logger(StandingsSource.name);

  constructor(
    @Inject(SEASON_RACES) private readonly races: SeasonRaces,
    @Inject(RESULTS_FOR_STANDINGS) private readonly results: ResultsForStandings,
  ) {}

  /**
   * По сезонам `seasonIds`; без них — все сезоны с протоколами. Сезон без протоколов в карту не попадает. Гонка без
   * ревизии (быть не должно) — пропуск с логом.
   */
  async load(seasonIds?: readonly string[]): Promise<Map<string, SeasonSource>> {
    const races = await this.races.protocolRaces(seasonIds);
    const revisions = await this.results.currentRevisions(races.map((race) => race.id));
    const bySeason = new Map<string, SourceRace[]>();
    for (const race of races) {
      const revision = revisions.get(race.id);
      if (revision === undefined) {
        this.logger.warn(`standings.revision_missing race=${race.id}`);
        continue;
      }
      const list = bySeason.get(race.seasonId) ?? [];
      list.push({ ...race, revision });
      bySeason.set(race.seasonId, list);
    }
    return new Map(
      [...bySeason].map(([id, list]) => [
        id,
        { races: list, fingerprint: sourceFingerprint(list), sourceVersion: sourceVersion(list) },
      ]),
    );
  }
}
