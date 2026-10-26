import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  DisputeDecisionRequest,
  FieldErrorCode,
  type PanelDispute,
  type PanelDisputePage,
  PanelDisputeQuery,
  type PanelDisputeSeries,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { DisputeSeriesService } from './dispute-series.service';
import { DisputesPanelService } from './disputes-panel.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Споры» панели (race-results-06): право — на каждом методе; `no-store` ставит `PanelGuard`. */
@Controller('admin/disputes')
@UseGuards(PanelGuard)
export class DisputesAdminController {
  constructor(
    private readonly disputes: DisputesPanelService,
    private readonly series: DisputeSeriesService,
  ) {}

  @Get()
  @RequirePermission('disputes.read')
  list(
    @Query(new ZodValidationPipe(PanelDisputeQuery, FieldErrorCode)) query: PanelDisputeQuery,
  ): Promise<PanelDisputePage> {
    return this.disputes.list(query);
  }

  @Get(':disputeId')
  @RequirePermission('disputes.read')
  get(@Param('disputeId', idPipe) disputeId: string): Promise<PanelDispute> {
    return this.disputes.get(disputeId);
  }

  /** Ряды пульса и мощности оспоренного результата (06b): `preparing` → опрос; биометрия — только здесь. */
  @Get(':disputeId/series')
  @RequirePermission('disputes.read')
  getSeries(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('disputeId', idPipe) disputeId: string,
  ): Promise<PanelDisputeSeries> {
    return this.series.get(principal, disputeId);
  }

  @Post(':disputeId/decision')
  @RequirePermission('disputes.decide')
  @HttpCode(200)
  decide(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('disputeId', idPipe) disputeId: string,
    @Body(new ZodValidationPipe(DisputeDecisionRequest, FieldErrorCode))
    body: DisputeDecisionRequest,
  ): Promise<PanelDispute> {
    return this.disputes.decide(principal, disputeId, body);
  }
}
