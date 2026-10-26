import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelRaceAttempt,
  type PanelRaceResults,
  ProtocolEntryActionRequest,
  ResultsActionRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ResultsProtocolService } from './results-protocol.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const actionPipe = new ZodValidationPipe(ResultsActionRequest, FieldErrorCode);
const entryActionPipe = new ZodValidationPipe(ProtocolEntryActionRequest, FieldErrorCode);

/**
 * Протокол гонки в панели — действия (race-results-05): до публикации — `results.manage` (исключить трек, вернуть в
 * обработку, перепроверить, опубликовать), после — `results.revise` (DQ, отмена DQ, перепроверка и её применение).
 * Тело — только причина (и участник); всё остальное считает сервер. Видимость гонки — как в панели гонок (404).
 */
@Controller('admin/races')
@UseGuards(PanelGuard)
export class ResultsProtocolController {
  constructor(private readonly protocol: ResultsProtocolService) {}

  @Post(':raceId/attempts/:attemptId/exclude')
  @RequirePermission('results.manage')
  @HttpCode(200)
  exclude(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Param('attemptId', idPipe) attemptId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceAttempt> {
    return this.protocol.exclude(principal, raceId, attemptId, body);
  }

  @Post(':raceId/attempts/:attemptId/restore')
  @RequirePermission('results.manage')
  @HttpCode(200)
  restore(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Param('attemptId', idPipe) attemptId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceAttempt> {
    return this.protocol.restore(principal, raceId, attemptId, body);
  }

  @Post(':raceId/results/recheck')
  @RequirePermission('results.manage')
  @HttpCode(200)
  recheck(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.requestRecheck(principal, raceId, body, { after: false });
  }

  @Post(':raceId/protocol')
  @RequirePermission('results.manage')
  @HttpCode(200)
  publish(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.publish(principal, raceId, body);
  }

  @Post(':raceId/protocol/disqualify')
  @RequirePermission('results.revise')
  @HttpCode(200)
  disqualify(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(entryActionPipe) body: ProtocolEntryActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.disqualify(principal, raceId, body);
  }

  @Post(':raceId/protocol/revoke-disqualification')
  @RequirePermission('results.revise')
  @HttpCode(200)
  revokeDisqualification(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(entryActionPipe) body: ProtocolEntryActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.revokeDisqualification(principal, raceId, body);
  }

  @Post(':raceId/protocol/recheck')
  @RequirePermission('results.revise')
  @HttpCode(200)
  recheckProtocol(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.requestRecheck(principal, raceId, body, { after: true });
  }

  @Post(':raceId/protocol/apply-recheck')
  @RequirePermission('results.revise')
  @HttpCode(200)
  applyRecheck(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param('raceId', idPipe) raceId: string,
    @Body(actionPipe) body: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    return this.protocol.applyRecheck(principal, raceId, body);
  }
}
