import { Body, Controller, Get, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  TotpCodeRequest,
  TotpDisableRequest,
  type TotpRecoveryCodes,
  type TotpSetup,
  type TotpStatus,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator';
import { PanelAccountTotpService } from './panel-account-totp.service';
import { PanelGuard } from './panel.guard';

/**
 * 2FA своего аккаунта (ADR-0024, D9): любая роль панели — `PanelGuard` без `@RequirePermission` (как `session/me`),
 * сотрудник — только из сессии. Тонкий слой.
 */
@Controller('admin/account/totp')
@UseGuards(PanelGuard)
export class PanelAccountTotpController {
  constructor(private readonly totp: PanelAccountTotpService) {}

  @Get()
  status(@CurrentPanelUser() principal: PanelPrincipal): Promise<TotpStatus> {
    return this.totp.status(principal);
  }

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentPanelUser() principal: PanelPrincipal): Promise<TotpSetup> {
    return this.totp.setup(principal);
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Body(new ZodValidationPipe(TotpCodeRequest, FieldErrorCode)) body: TotpCodeRequest,
    @Ip() ip: string,
  ): Promise<TotpRecoveryCodes> {
    return this.totp.confirm(principal, body.code, ip);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Body(new ZodValidationPipe(TotpCodeRequest, FieldErrorCode)) body: TotpCodeRequest,
    @Ip() ip: string,
  ): Promise<TotpRecoveryCodes> {
    return this.totp.regenerateRecoveryCodes(principal, body.code, ip);
  }

  @Post('disable')
  @HttpCode(204)
  disable(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Body(new ZodValidationPipe(TotpDisableRequest, FieldErrorCode)) body: TotpDisableRequest,
    @Ip() ip: string,
  ): Promise<void> {
    return this.totp.disable(principal, body, ip);
  }
}
