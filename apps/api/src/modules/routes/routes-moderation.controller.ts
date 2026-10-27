import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApproveRiderRouteRequest,
  DismissRiderRouteReportsRequest,
  FieldErrorCode,
  HideRiderRouteRequest,
  RejectRiderRouteRequest,
  RestoreRiderRouteRequest,
  type RiderRouteModerationDetail,
  type RiderRouteModerationPage,
  RiderRouteModerationQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { RoutesModerationService } from './routes-moderation.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * «Маршруты райдеров» панели (routes-06, `routes.moderate` — admin и moderator): очереди, карточка заявки, одобрить /
 * отклонить / скрыть / вернуть / отклонить жалобы; `no-store` ставит `PanelGuard`.
 */
@Controller('admin/rider-routes')
@UseGuards(PanelGuard)
@RequirePermission('routes.moderate')
export class RoutesModerationController {
  constructor(private readonly moderation: RoutesModerationService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(RiderRouteModerationQuery, FieldErrorCode))
    query: RiderRouteModerationQuery,
  ): Promise<RiderRouteModerationPage> {
    return this.moderation.list(query);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<RiderRouteModerationDetail> {
    return this.moderation.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApproveRiderRouteRequest, FieldErrorCode))
    body: ApproveRiderRouteRequest,
  ): Promise<RiderRouteModerationDetail> {
    return this.moderation.approve(actor.userId, id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RejectRiderRouteRequest, FieldErrorCode))
    body: RejectRiderRouteRequest,
  ): Promise<RiderRouteModerationDetail> {
    return this.moderation.reject(actor.userId, id, body);
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(HideRiderRouteRequest, FieldErrorCode)) body: HideRiderRouteRequest,
  ): Promise<RiderRouteModerationDetail> {
    return this.moderation.hide(actor.userId, id, body);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RestoreRiderRouteRequest, FieldErrorCode))
    body: RestoreRiderRouteRequest,
  ): Promise<RiderRouteModerationDetail> {
    return this.moderation.restore(actor.userId, id, body);
  }

  @Post(':id/dismiss-reports')
  @HttpCode(200)
  dismiss(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DismissRiderRouteReportsRequest, FieldErrorCode))
    body: DismissRiderRouteReportsRequest,
  ): Promise<RiderRouteModerationDetail> {
    return this.moderation.dismiss(actor.userId, id, body);
  }
}
