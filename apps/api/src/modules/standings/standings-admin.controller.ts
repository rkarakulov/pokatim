import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelSeasonStandingsSummary,
  type PanelSeasonStandingsTable,
  SeasonStandingsTableQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { StandingsReadService } from './standings-read.service';

const seasonIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Рейтинг сезона в панели (race-results-08) — только чтение, `races.read` (`no-store` ставит `PanelGuard`): сводка с
 * версией формулы и «ждёт пересчёта», таблица — `userId` строки только сотруднику, видящему все гонки (RC-8).
 */
@Controller('admin/seasons/:id/standings')
@UseGuards(PanelGuard)
export class StandingsAdminController {
  constructor(private readonly read: StandingsReadService) {}

  @Get()
  @RequirePermission('races.read')
  summary(@Param('id', seasonIdPipe) seasonId: string): Promise<PanelSeasonStandingsSummary> {
    return this.read.panelSummary(seasonId);
  }

  @Get('table')
  @RequirePermission('races.read')
  table(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('id', seasonIdPipe) seasonId: string,
    @Query(new ZodValidationPipe(SeasonStandingsTableQuery, FieldErrorCode))
    query: SeasonStandingsTableQuery,
  ): Promise<PanelSeasonStandingsTable> {
    return this.read.panelTable(principal, seasonId, query);
  }
}
