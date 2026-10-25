import { Body, Controller, Get, HttpCode, Ip, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelMe,
  PanelSignInRequest,
  type PanelSignInResponse,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator';
import { PanelGuard } from './panel.guard';
import { PanelSessionCookie } from './panel-session-cookie';
import { PanelSessionService } from './panel-session.service';
import { Public } from './public.decorator';

/**
 * Сессия панели (ADR-0009): вход, выход, «кто я». Путь — под `PANEL_SESSION_COOKIE.path`: вход видит прежнюю cookie
 * этого браузера и отзывает её сессию. Транспорт — только cookie; тонкий слой.
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
    const previous = this.cookie.read(request).token;
    const result = await this.sessions.signIn(body, ip, previous);
    if (result.state === 'verificationRequired') return result;
    this.cookie.set(reply, result.token, result.expiresAt);
    return { state: 'signedIn', me: result.me };
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
