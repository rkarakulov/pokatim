import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  ResetRiderNameRequest,
  type RiderNameResetResult,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ProfileModerationService } from './profile-moderation.service';

/** Профили райдеров в панели (profile-02, `profiles.moderate` — admin и moderator); `no-store` ставит `PanelGuard`. */
@Controller('admin/profiles')
@UseGuards(PanelGuard)
@RequirePermission('profiles.moderate')
export class ProfileAdminController {
  constructor(private readonly moderation: ProfileModerationService) {}

  /** Сброс публичного имени с причиной (журнал действий без имени). */
  @Post(':userId/name-reset')
  @HttpCode(200)
  resetName(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', new ZodValidationPipe(Uuid, FieldErrorCode)) userId: string,
    @Body(new ZodValidationPipe(ResetRiderNameRequest, FieldErrorCode)) body: ResetRiderNameRequest,
  ): Promise<RiderNameResetResult> {
    return this.moderation.resetName(actor.userId, userId, body);
  }
}
