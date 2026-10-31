import { Inject, Injectable } from '@nestjs/common';
import type {
  MySeasonStanding,
  MySeasonStandings,
  PanelSeasonStandingCell,
  PanelSeasonStandingsSummary,
  PanelSeasonStandingsTable,
  SeasonStandingsRace,
  SeasonStandingsSummary,
  SeasonStandingsTable,
  SeasonStandingsTableQuery,
} from '@pokatim/contracts';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import type { PanelPrincipal } from '../panel';
import { RIDER_NAMES, type RiderNameDirectory, riderRowFields } from '../profile';
import { SEASON_RACES, type SeasonRaces } from '../races';
import type {
  SeasonStandingRowDoc,
  SeasonStandingsDoc,
  StandingCellDoc,
  StandingsTableDoc,
} from './standings.collection';
import { StandingsSource } from './standings-source';
import { StandingsRepository } from './standings.repository';

const notFound = () => domainError('NOT_FOUND', 404);
const invalidCursor = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });
/** Ключ курсора — `order` последней строки страницы. */
const OrderCursorKey = z.string().regex(/^\d{1,7}$/);

const iso = (at: Date | undefined) => at?.toISOString() ?? null;

/** Строгий тип (панели): снимок пишет только известные значения — он же подходит tolerant-ответам приложения. */
const toCell = (cell: StandingCellDoc): PanelSeasonStandingCell => ({
  raceId: cell.raceId,
  place: cell.place,
  tied: cell.tied,
  outcome: cell.outcome,
  points: cell.points,
  counted: cell.counted,
});

/** Гонки снимка по id (порядок — как в `ids`). */
function racesOf(header: SeasonStandingsDoc | undefined, ids: readonly string[]) {
  const byId = new Map((header?.races ?? []).map((race) => [race.raceId, race]));
  return ids.flatMap((id): SeasonStandingsRace[] => {
    const race = byId.get(id);
    return race ? [{ id, title: race.title, windowEndsAt: race.windowEndsAt.toISOString() }] : [];
  });
}

interface RawPage {
  header: SeasonStandingsDoc | undefined;
  table: StandingsTableDoc | undefined;
  rows: SeasonStandingRowDoc[];
  more: boolean;
}

/**
 * Чтение рейтинга сезона (race-results-08): только снимок (HTTP ничего не считает). Публичные ответы — без `userId`,
 * имя — только с согласием (порт `RIDER_NAMES`, вне snapshot-сессии); панель — `userId` только сотруднику, видящему
 * все гонки (RC-8). Неизвестный сезон — `404` до разбора курсора (RC-7).
 */
@Injectable()
export class StandingsReadService {
  constructor(
    private readonly repository: StandingsRepository,
    private readonly source: StandingsSource,
    @Inject(SEASON_RACES) private readonly seasons: SeasonRaces,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async summary(seasonId: string): Promise<SeasonStandingsSummary> {
    await this.requireSeason(seasonId);
    return this.summaryOf(seasonId, await this.repository.header(seasonId));
  }

  async table(seasonId: string, query: SeasonStandingsTableQuery): Promise<SeasonStandingsTable> {
    const { header, table, rows, more, riders } = await this.page(seasonId, query);
    return {
      ...this.tableHead(header, table, query),
      items: rows.map((row) => ({
        order: row.order,
        place: row.place,
        tied: row.tied,
        ...riderRowFields(riders.get(row.userId)),
        points: row.points,
        cells: row.cells.map(toCell),
      })),
      nextCursor: more ? encodeCursor(String(rows.at(-1)!.order), seasonId) : null,
    };
  }

  async mine(seasonId: string, userId: string): Promise<MySeasonStandings> {
    await this.requireSeason(seasonId);
    const { header, rows } = await this.repository.withSnapshot(async (session) => ({
      header: await this.repository.header(seasonId, session),
      rows: await this.repository.rowsOfUser(seasonId, userId, session),
    }));
    const tables = header?.tables ?? [];
    const items = tables.flatMap((table): MySeasonStanding[] => {
      const row = rows.find(
        (candidate) =>
          candidate.bikeClass === table.bikeClass && candidate.groupKey === table.groupKey,
      );
      if (!row) return [];
      return [
        {
          bikeClass: table.bikeClass,
          groupKey: table.groupKey,
          order: row.order,
          place: row.place,
          tied: row.tied,
          points: row.points,
          riders: table.riders,
          racesTotal: table.racesTotal,
          racesCounted: table.racesCounted,
          raceIds: table.raceIds,
          cells: row.cells.map(toCell),
        },
      ];
    });
    const raceIds = new Set(items.flatMap((item) => item.raceIds));
    return {
      seasonId,
      computedAt: iso(header?.computedAt),
      races: racesOf(
        header,
        (header?.races ?? []).map((race) => race.raceId).filter((id) => raceIds.has(id)),
      ),
      items,
    };
  }

  /** Сводка панели (RC-14): + версия формулы и «ждёт пересчёта» по тому же отпечатку, что регламент. */
  async panelSummary(seasonId: string): Promise<PanelSeasonStandingsSummary> {
    await this.requireSeason(seasonId);
    const header = await this.repository.header(seasonId);
    const source = (await this.source.load([seasonId])).get(seasonId);
    const pending = source !== undefined && source.fingerprint !== header?.fingerprint;
    return {
      ...this.summaryOf(seasonId, header),
      formulaVersion: header?.formulaVersion ?? null,
      sync: pending ? 'pending' : 'current',
    };
  }

  async panelTable(
    principal: PanelPrincipal,
    seasonId: string,
    query: SeasonStandingsTableQuery,
  ): Promise<PanelSeasonStandingsTable> {
    const showUserId = this.seasons.seesAllRaces(principal);
    const { header, table, rows, more, riders } = await this.page(seasonId, query);
    return {
      ...this.tableHead(header, table, query),
      items: rows.map((row) => ({
        order: row.order,
        place: row.place,
        tied: row.tied,
        ...riderRowFields(riders.get(row.userId)),
        points: row.points,
        cells: row.cells.map(toCell),
        userId: showUserId ? row.userId : null,
      })),
      nextCursor: more ? encodeCursor(String(rows.at(-1)!.order), seasonId) : null,
    };
  }

  private async requireSeason(seasonId: string): Promise<void> {
    if (!(await this.seasons.seasonExists(seasonId))) throw notFound();
  }

  private summaryOf(
    seasonId: string,
    header: SeasonStandingsDoc | undefined,
  ): Omit<PanelSeasonStandingsSummary, 'formulaVersion' | 'sync'> {
    return {
      seasonId,
      computedAt: iso(header?.computedAt),
      tables: (header?.tables ?? []).map((table) => ({
        bikeClass: table.bikeClass,
        groupKey: table.groupKey,
        riders: table.riders,
        racesTotal: table.racesTotal,
        racesCounted: table.racesCounted,
      })),
    };
  }

  /** Страница таблицы из одного снимка; таблицы нет в снимке — пустая страница (RC-12). Имена — вне сессии. */
  private async page(seasonId: string, query: SeasonStandingsTableQuery) {
    await this.requireSeason(seasonId);
    let afterOrder: number | null = null;
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, OrderCursorKey);
      if (cursor.id !== seasonId) throw invalidCursor();
      afterOrder = Number(cursor.k);
    }
    const raw = await this.repository.withSnapshot(async (session): Promise<RawPage> => {
      const header = await this.repository.header(seasonId, session);
      const table = header?.tables.find(
        (candidate) =>
          candidate.bikeClass === query.bikeClass && candidate.groupKey === query.group,
      );
      if (!table) return { header, table, rows: [], more: false };
      const rows = await this.repository.rowsPage(
        seasonId,
        query.bikeClass,
        query.group,
        afterOrder,
        query.limit + 1,
        session,
      );
      return { header, table, rows: rows.slice(0, query.limit), more: rows.length > query.limit };
    });
    const riders = await this.names.publicRiders(raw.rows.map((row) => row.userId));
    return { ...raw, riders };
  }

  private tableHead(
    header: SeasonStandingsDoc | undefined,
    table: StandingsTableDoc | undefined,
    query: SeasonStandingsTableQuery,
  ) {
    return {
      bikeClass: query.bikeClass,
      groupKey: query.group,
      computedAt: iso(header?.computedAt),
      racesTotal: table?.racesTotal ?? 0,
      racesCounted: table?.racesCounted ?? 0,
      riders: table?.riders ?? 0,
      races: table ? racesOf(header, table.raceIds) : [],
    };
  }
}
