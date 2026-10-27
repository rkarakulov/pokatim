import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type PanelAppearance, UpdateAppearanceRequest } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { AppearanceService } from './appearance.service';

/** «Оформление приложения» панели (`appearance.manage` — только admin): настройка-синглтон, замена по `version`. */
@Controller('admin/appearance')
@UseGuards(PanelGuard)
@RequirePermission('appearance.manage')
export class AppearanceAdminController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  get(): Promise<PanelAppearance> {
    return this.appearance.getPanel();
  }

  @Put()
  @HttpCode(200)
  update(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(UpdateAppearanceRequest, FieldErrorCode))
    body: UpdateAppearanceRequest,
  ): Promise<PanelAppearance> {
    return this.appearance.update(actor.userId, body);
  }
}
