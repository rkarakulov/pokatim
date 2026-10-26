import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelProtocolRecalculations,
  type PanelRaceAttemptPage,
  PanelRaceAttemptQuery,
  type PanelRaceResults,
  type PanelRaceStandings,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ResultsPanelReadService } from './results-panel-read.service';

const raceIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Результаты гонки в панели — чтение (race-results-03, 05): сводка с фазой, протоколом и чек-листом, попытки
 * (включая финальные провалы проверки — dead-letter — и исключённые), «Участники», история пересчётов. `races.read`;
 * видимость гонки — как в панели гонок (чужая гонка организатора — 404). Мутации — `ResultsProtocolController`.
 */
@Controller('admin/races')
@UseGuards(PanelGuard)
export class ResultsAdminController {
  constructor(private readonly read: ResultsPanelReadService) {}

  @Get(':raceId/results')
  @RequirePermission('races.read')
  summary(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<PanelRaceResults> {
    return this.read.summary(principal, raceId);
  }

  @Get(':raceId/attempts')
  @RequirePermission('races.read')
  attempts(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
    @Query(new ZodValidationPipe(PanelRaceAttemptQuery, FieldErrorCode))
    query: PanelRaceAttemptQuery,
  ): Promise<PanelRaceAttemptPage> {
    return this.read.attempts(principal, raceId, query);
  }

  @Get(':raceId/standings')
  @RequirePermission('races.read')
  standings(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<PanelRaceStandings> {
    return this.read.standings(principal, raceId);
  }

  @Get(':raceId/protocol/recalculations')
  @RequirePermission('races.read')
  recalculations(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<PanelProtocolRecalculations> {
    return this.read.recalculations(principal, raceId);
  }
}
