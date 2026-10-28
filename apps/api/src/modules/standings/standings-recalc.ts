import { performance } from 'node:perf_hooks';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { RESULTS_FOR_STANDINGS, type ResultsForStandings } from '../results';
import type { SeasonStandingRowDoc, SeasonStandingsDoc } from './standings.collection';
import { buildSeasonStandings, STANDINGS_FORMULA_VERSION } from './standings.policy';
import { type SeasonSource, StandingsSource } from './standings-source';
import { StandingsRepository } from './standings.repository';

export interface StandingsSyncRun {
  seasons: number;
  recomputed: number;
  stale: number;
  /** снимок не старше источника, а отпечаток другой (откат деплоя, вход отпечатка без версии формулы) — пропуск */
  conflicts: number;
  failed: number;
}

/**
 * Пересчёт рейтинга сезонов (race-results-08, DV-1): регламент сверяет отпечаток источника сезона с отпечатком
 * снимка и пересчитывает изменившиеся сезоны полностью. Идемпотентен: без изменений — без записи; параллельные
 * пересчёты одного сезона снимок не откатывают (RC-5).
 */
@Injectable()
export class StandingsRecalc {
  private readonly logger = new Logger(StandingsRecalc.name);

  constructor(
    private readonly source: StandingsSource,
    private readonly repository: StandingsRepository,
    private readonly transactions: MongoTransactions,
    @Inject(RESULTS_FOR_STANDINGS) private readonly results: ResultsForStandings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Один проход регламента; отказ сезона не останавливает остальные, после прохода при отказах — исключение. */
  async sync(): Promise<StandingsSyncRun> {
    const sources = await this.source.load();
    const states = await this.repository.snapshotStates([...sources.keys()]);
    const run: StandingsSyncRun = {
      seasons: sources.size,
      recomputed: 0,
      stale: 0,
      conflicts: 0,
      failed: 0,
    };
    for (const [seasonId, source] of sources) {
      const state = states.get(seasonId);
      if (state?.fingerprint === source.fingerprint) continue;
      // запись всё равно была бы `stale` (RC-5): без пропуска регламент пересчитывал бы сезон каждую минуту
      if (state && !isOlder(state, source.sourceVersion)) {
        run.conflicts += 1;
        this.logger.warn(
          `standings.version_conflict season=${seasonId} formula=${state.formulaVersion} source=${state.sourceVersion}`,
        );
        continue;
      }
      try {
        const outcome = await this.recompute(seasonId, source);
        if (outcome === 'stale') run.stale += 1;
        else run.recomputed += 1;
      } catch (error) {
        run.failed += 1;
        this.logger.error(
          `standings.recompute_failed season=${seasonId}: ${(error as Error).message}`,
        );
      }
    }
    if (run.failed > 0) {
      this.logger.error(`standings.sync_failed failed=${run.failed}`);
      throw new Error('standings.sync_failed');
    }
    return run;
  }

  /** Полный пересчёт сезона по источнику: строки текущих ревизий → таблицы → снимок целиком. */
  async recompute(seasonId: string, source: SeasonSource): Promise<'written' | 'stale'> {
    const started = performance.now();
    const races = [];
    for (const race of source.races) {
      races.push({ ...race, rows: await this.results.protocolRows(race.id, race.revision) });
    }
    const tables = buildSeasonStandings(races);
    const header: SeasonStandingsDoc = {
      _id: seasonId,
      formulaVersion: STANDINGS_FORMULA_VERSION,
      sourceVersion: source.sourceVersion,
      fingerprint: source.fingerprint,
      computedAt: this.clock.now(),
      races: [...source.races]
        .sort(
          (a, b) =>
            a.windowEndsAt.getTime() - b.windowEndsAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .map((race) => ({
          raceId: race.id,
          title: race.title,
          windowEndsAt: race.windowEndsAt,
          bikeClass: race.bikeClass,
          groupScheme: race.groupScheme,
          revision: race.revision,
        })),
      tables: tables.map((table) => ({
        bikeClass: table.bikeClass,
        groupKey: table.groupKey,
        raceIds: table.raceIds,
        racesTotal: table.racesTotal,
        racesCounted: table.racesCounted,
        riders: table.rows.length,
      })),
    };
    const rows: SeasonStandingRowDoc[] = tables.flatMap((table) =>
      table.rows.map((row) => ({
        _id: uuidv7(),
        seasonId,
        bikeClass: table.bikeClass,
        groupKey: table.groupKey,
        order: row.order,
        userId: row.userId,
        place: row.place,
        tied: row.tied,
        points: row.points,
        cells: row.cells,
      })),
    );
    const outcome = await this.writeSnapshot(header, rows);
    if (outcome === 'written') {
      this.logger.log(
        `standings.recomputed season=${seasonId} tables=${tables.length} rows=${rows.length} ms=${Math.round(performance.now() - started)}`,
      );
    }
    return outcome;
  }

  /**
   * Снимок целиком одной транзакцией (RC-5): первая операция — условный заголовок, затем строки. Сохранённый снимок
   * не старше — `stale` (транзакция откатывается, строки не тронуты). Внутри колбэка — без побочных эффектов.
   */
  async writeSnapshot(
    header: SeasonStandingsDoc,
    rows: SeasonStandingRowDoc[],
  ): Promise<'written' | 'stale'> {
    try {
      await this.transactions.run(async (tx) => {
        await this.repository.claimSeason(tx, header);
        await this.repository.replaceRows(tx, header._id, rows);
      });
      return 'written';
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      this.logger.warn(`standings.stale season=${header._id}`);
      return 'stale';
    }
  }
}

/** Сохранённый снимок старше текущего источника — то же условие, что фильтр `claimSeason`. */
function isOlder(
  state: { formulaVersion: number; sourceVersion: number },
  sourceVersion: number,
): boolean {
  return (
    state.formulaVersion < STANDINGS_FORMULA_VERSION ||
    (state.formulaVersion === STANDINGS_FORMULA_VERSION && state.sourceVersion < sourceVersion)
  );
}
