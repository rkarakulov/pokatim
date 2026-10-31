import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ClearRiderAchievementOverrideRequest,
  type ClearRiderAchievementOverrideResult,
  FieldErrorCode,
  GrantRiderAchievementRequest,
  RevokeRiderAchievementRequest,
  type RiderAchievementsAdmin,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { AchievementsPanelService } from './achievements-panel.service';

const userIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Достижения райдера в панели (achievements-panel, `achievements.manage` — только admin): список выдач, ручная выдача,
 * ручной отзыв, снятие ручного решения. Актор — `@CurrentPanelUser()`; `no-store` ставит `PanelGuard`.
 */
@Controller('admin/rider-achievements')
@UseGuards(PanelGuard)
@RequirePermission('achievements.manage')
export class AchievementsAdminController {
  constructor(private readonly panel: AchievementsPanelService) {}

  @Get(':userId')
  list(@Param('userId', userIdPipe) userId: string): Promise<RiderAchievementsAdmin> {
    return this.panel.list(userId);
  }

  @Post(':userId/grant')
  @HttpCode(204)
  async grant(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(GrantRiderAchievementRequest, FieldErrorCode))
    body: GrantRiderAchievementRequest,
  ): Promise<void> {
    await this.panel.grant(actor.userId, userId, body);
  }

  @Post(':userId/revoke')
  @HttpCode(204)
  async revoke(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(RevokeRiderAchievementRequest, FieldErrorCode))
    body: RevokeRiderAchievementRequest,
  ): Promise<void> {
    await this.panel.revoke(actor.userId, userId, body);
  }

  @Post(':userId/clear')
  @HttpCode(200)
  clear(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(ClearRiderAchievementOverrideRequest, FieldErrorCode))
    body: ClearRiderAchievementOverrideRequest,
  ): Promise<ClearRiderAchievementOverrideResult> {
    return this.panel.clear(actor.userId, userId, body);
  }
}
