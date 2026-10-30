import { Body, Controller, Get, HttpCode, Ip, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelMe,
  type PanelSignedIn,
  type PanelSignedInWithRecoveryCodes,
  PanelSignInRequest,
  type PanelSignInResponse,
  type TotpSetup,
  TotpSetupConfirmRequest,
  TotpSetupStartRequest,
  TotpSignInRequest,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator';
import { PanelGuard } from './panel.guard';
import { PanelSessionCookie } from './panel-session-cookie';
import { PanelSessionService } from './panel-session.service';
import { Public } from './public.decorator';

/**
 * Сессия панели (ADR-0009; 2FA — ADR-0024): вход, второй шаг (код, подключение 2FA на входе), выход, «кто я». Путь —
 * под `PANEL_SESSION_COOKIE.path`: вход видит прежнюю cookie этого браузера и отзывает её сессию; cookie устройства
 * (`PANEL_DEVICE_COOKIE`) видна только здесь. Транспорт — только cookie; тонкий слой.
 */
@Controller('admin/session')
@UseGuards(PanelGuard)
export class PanelSessionController {
  constructor(
    private readonly sessions: PanelSessionService,
    private readonly cookie: PanelSessionCookie,
  ) {}

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(PanelSignInRequest, FieldErrorCode)) body: PanelSignInRequest,
    @Req() request: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<PanelSignInResponse> {
    const result = await this.sessions.signIn(
      body,
      ip,
      this.cookie.read(request).token,
      this.cookie.readDevice(request),
    );
    if (result.state !== 'signedIn') return result;
    return this.cookie.signedIn(reply, result);
  }

  /** Второй шаг: код TOTP или код восстановления по вызову (без сессии — `@Public`, вызов проверяет сервис). */
  @Post('sign-in/totp')
  @Public()
  @HttpCode(200)
  async signInTotp(
    @Body(new ZodValidationPipe(TotpSignInRequest, FieldErrorCode)) body: TotpSignInRequest,
    @Req() request: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<PanelSignedIn> {
    const result = await this.sessions.completeTotp(body, ip, this.cookie.read(request).token);
    return this.cookie.signedIn(reply, result);
  }

  /** Подключение 2FA на экране входа (`totpSetupRequired`): секрет и otpauth — один раз. */
  @Post('sign-in/totp-setup')
  @Public()
  @HttpCode(200)
  signInTotpSetup(
    @Body(new ZodValidationPipe(TotpSetupStartRequest, FieldErrorCode)) body: TotpSetupStartRequest,
    @Ip() ip: string,
  ): Promise<TotpSetup> {
    return this.sessions.startSetup(body.challenge, ip);
  }

  @Post('sign-in/totp-setup/confirm')
  @Public()
  @HttpCode(200)
  async signInTotpSetupConfirm(
    @Body(new ZodValidationPipe(TotpSetupConfirmRequest, FieldErrorCode))
    body: TotpSetupConfirmRequest,
    @Req() request: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<PanelSignedInWithRecoveryCodes> {
    const result = await this.sessions.confirmSetup(body, ip, this.cookie.read(request).token);
    return { ...this.cookie.signedIn(reply, result), recoveryCodes: result.recoveryCodes };
  }

  /** Идемпотентно: 204 и сброс cookie в любом случае — ответ не говорит, была ли сессия. */
  @Post('sign-out')
  @Public()
  @HttpCode(204)
  async signOut(
    @Req() request: unknown,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<void> {
    await this.sessions.signOut(this.cookie.read(request).token);
    this.cookie.clear(reply);
  }

  @Get('me')
  me(@CurrentPanelUser() principal: PanelPrincipal): Promise<PanelMe> {
    return this.sessions.me(principal);
  }
}
