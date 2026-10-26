import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  DismissRideReportsRequest,
  FieldErrorCode,
  HideRideRequest,
  type ModerationRideDetail,
  type ModerationRidePage,
  ModerationRideQuery,
  RestoreRideRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { RidesModerationService } from './rides-moderation.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Модерация райдов» панели (05b, `rides.moderate` — admin и moderator); `no-store` ставит `PanelGuard`. */
@Controller('admin/rides')
@UseGuards(PanelGuard)
@RequirePermission('rides.moderate')
export class RidesModerationController {
  constructor(private readonly moderation: RidesModerationService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ModerationRideQuery, FieldErrorCode)) query: ModerationRideQuery,
  ): Promise<ModerationRidePage> {
    return this.moderation.list(query);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<ModerationRideDetail> {
    return this.moderation.get(id);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(HideRideRequest, FieldErrorCode)) body: HideRideRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.hide(actor.userId, id, body);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RestoreRideRequest, FieldErrorCode)) body: RestoreRideRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.restore(actor.userId, id, body);
  }

  @Post(':id/dismiss-reports')
  @HttpCode(200)
  dismiss(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DismissRideReportsRequest, FieldErrorCode))
    body: DismissRideReportsRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.dismiss(actor.userId, id, body);
  }
}
