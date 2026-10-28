import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  DismissRiderProfileReportsRequest,
  FieldErrorCode,
  type RiderProfileModerationDetail,
  type RiderProfileModerationPage,
  RiderProfileModerationQuery,
  type RiderProfileReportsDismissResult,
  RiderProfileResetRequest,
  type RiderProfileResetResult,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ProfileModerationService } from './profile-moderation.service';

const userIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * «Профили райдеров» панели (profile-moderation, `profiles.moderate` — admin и moderator): очередь жалоб, карточка,
 * сброс фото и клуба, «Отклонить жалобы»; сброс имени — `ProfileAdminController`. `no-store` ставит `PanelGuard`.
 */
@Controller('admin/rider-profiles')
@UseGuards(PanelGuard)
@RequirePermission('profiles.moderate')
export class RiderProfilesModerationController {
  constructor(private readonly moderation: ProfileModerationService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(RiderProfileModerationQuery, FieldErrorCode))
    query: RiderProfileModerationQuery,
  ): Promise<RiderProfileModerationPage> {
    return this.moderation.list(query);
  }

  @Get(':userId')
  detail(@Param('userId', userIdPipe) userId: string): Promise<RiderProfileModerationDetail> {
    return this.moderation.detail(userId);
  }

  @Post(':userId/avatar-reset')
  @HttpCode(200)
  resetAvatar(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(RiderProfileResetRequest, FieldErrorCode))
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.moderation.resetAvatar(actor.userId, userId, body);
  }

  @Post(':userId/club-reset')
  @HttpCode(200)
  resetClub(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(RiderProfileResetRequest, FieldErrorCode))
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.moderation.resetClub(actor.userId, userId, body);
  }

  @Post(':userId/dismiss-reports')
  @HttpCode(200)
  dismissReports(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(DismissRiderProfileReportsRequest, FieldErrorCode))
    body: DismissRiderProfileReportsRequest,
  ): Promise<RiderProfileReportsDismissResult> {
    return this.moderation.dismissReports(actor.userId, userId, body);
  }
}
