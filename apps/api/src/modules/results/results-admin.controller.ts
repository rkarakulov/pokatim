import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelRaceAttemptPage,
  PanelRaceAttemptQuery,
  type PanelRaceResults,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ResultsReadService } from './results-read.service';

const raceIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Результаты гонки в панели (race-results-03, только чтение): сводка и попытки, включая финальные провалы проверки
 * (dead-letter). `races.read`; видимость гонки — как в панели гонок (чужая гонка организатора — 404).
 */
@Controller('admin/races')
@UseGuards(PanelGuard)
export class ResultsAdminController {
  constructor(private readonly read: ResultsReadService) {}

  @Get(':raceId/results')
  @RequirePermission('races.read')
  summary(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<PanelRaceResults> {
    return this.read.panelSummary(principal, raceId);
  }

  @Get(':raceId/attempts')
  @RequirePermission('races.read')
  attempts(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', raceIdPipe) raceId: string,
    @Query(new ZodValidationPipe(PanelRaceAttemptQuery, FieldErrorCode))
    query: PanelRaceAttemptQuery,
  ): Promise<PanelRaceAttemptPage> {
    return this.read.panelAttempts(principal, raceId, query);
  }
}
