import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  DisputeDecisionRequest,
  FieldErrorCode,
  type PanelDispute,
  type PanelDisputePage,
  PanelDisputeQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { DisputesPanelService } from './disputes-panel.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Споры» панели (race-results-06): право — на каждом методе; `no-store` ставит `PanelGuard`. */
@Controller('admin/disputes')
@UseGuards(PanelGuard)
export class DisputesAdminController {
  constructor(private readonly disputes: DisputesPanelService) {}

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
