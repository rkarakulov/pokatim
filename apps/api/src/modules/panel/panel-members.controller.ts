import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ChangeRoleRequest,
  FieldErrorCode,
  GrantRoleRequest,
  type PanelMember,
  type PanelMemberList,
  RevokeRoleRequest,
  TotpResetRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator';
import { PanelGuard } from './panel.guard';
import { PanelMembersService } from './panel-members.service';
import { RequirePermission } from './require-permission.decorator';

const userIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * «Сотрудники» (решение автора Q3: выдаёт, меняет и снимает роли только admin). Актор — из сессии панели, цель —
 * `Uuid` из пути. Тонкий слой: решения и журнал — в `PanelMembersService`.
 */
@Controller('admin/members')
@UseGuards(PanelGuard)
export class PanelMembersController {
  constructor(private readonly members: PanelMembersService) {}

  @Get()
  @RequirePermission('members.read')
  list(): Promise<PanelMemberList> {
    return this.members.list();
  }

  @Post()
  @RequirePermission('members.manage')
  @HttpCode(201)
  grant(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(GrantRoleRequest, FieldErrorCode)) body: GrantRoleRequest,
  ): Promise<PanelMember> {
    return this.members.grant(actor.userId, body);
  }

  @Post(':userId/role')
  @RequirePermission('members.manage')
  @HttpCode(200)
  changeRole(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(ChangeRoleRequest, FieldErrorCode)) body: ChangeRoleRequest,
  ): Promise<PanelMember> {
    return this.members.changeRole(actor.userId, userId, body);
  }

  @Post(':userId/revoke')
  @RequirePermission('members.manage')
  @HttpCode(200)
  revoke(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(RevokeRoleRequest, FieldErrorCode)) body: RevokeRoleRequest,
  ): Promise<PanelMember> {
    return this.members.revoke(actor.userId, userId, body);
  }

  /** Сброс 2FA сотрудника (ADR-0024, D10): причина обязательна, себе — 409; сессии цели отзываются. */
  @Post(':userId/totp/reset')
  @RequirePermission('members.manage')
  @HttpCode(204)
  resetTotp(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(TotpResetRequest, FieldErrorCode)) body: TotpResetRequest,
  ): Promise<void> {
    return this.members.resetTotp(actor, userId, body);
  }
}
