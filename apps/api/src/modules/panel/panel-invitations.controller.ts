import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  FieldErrorCode,
  InvitationAcceptRequest,
  InviteRequest,
  type PanelInvitation,
  type PanelInvitationList,
  type PanelSignInResponse,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { IpRateLimit, IpRateLimitGuard } from '../../public-read.guard';
import { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator';
import { PanelGuard } from './panel.guard';
import { PANEL_POLICY } from './panel.policy';
import { PanelInvitationAccept } from './panel-invitation-accept';
import { PanelInvitationsService } from './panel-invitations.service';
import { PanelSessionCookie } from './panel-session-cookie';
import { Public } from './public.decorator';
import { RequirePermission } from './require-permission.decorator';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Приглашения в команду (ADR-0026): список — `members.read`, приглашение и отзыв — `members.manage`; принятие —
 * `@Public` шаг входа паролем (IP-лимит до пароля, cookie сессии — как у входа). Статический `accept` (2 сегмента) с
 * `:id/revoke` (3 сегмента) не пересекается. Тонкий слой.
 */
@Controller('admin/invitations')
@UseGuards(PanelGuard)
export class PanelInvitationsController {
  constructor(
    private readonly invitations: PanelInvitationsService,
    private readonly acceptance: PanelInvitationAccept,
    private readonly cookie: PanelSessionCookie,
  ) {}

  @Get()
  @RequirePermission('members.read')
  list(): Promise<PanelInvitationList> {
    return this.invitations.list();
  }

  @Post()
  @RequirePermission('members.manage')
  @HttpCode(201)
  invite(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(InviteRequest, FieldErrorCode)) body: InviteRequest,
  ): Promise<PanelInvitation> {
    return this.invitations.invite(actor, body);
  }

  @Post(':id/revoke')
  @RequirePermission('members.manage')
  @HttpCode(204)
  revoke(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    return this.invitations.revoke(actor, id);
  }

  /** Принять паролем: ответ — как у `session/sign-in`; токен — в теле (не в URL и логах доступа). */
  @Post('accept')
  @Public()
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('panel-invitation-accept', PANEL_POLICY.invitationAcceptIpLimit)
  @HttpCode(200)
  async accept(
    @Body(new ZodValidationPipe(InvitationAcceptRequest, FieldErrorCode))
    body: InvitationAcceptRequest,
    @Req() request: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<PanelSignInResponse> {
    const result = await this.acceptance.accept(body, ip, this.cookie.read(request).token);
    if (result.state !== 'signedIn') return result;
    return this.cookie.signedIn(reply, result);
  }
}
