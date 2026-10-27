import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelVerifiedDemographics,
  UpdateVerifiedDemographicsRequest,
  Uuid,
  type VerifiedDemographicsResult,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ProfileVerifiedAdminService } from './profile-verified-admin.service';

/**
 * Пол и год анкеты Verified в панели (race-results-07, `profiles.verified_edit` — только admin). Отдельный класс: у
 * `ProfileAdminController` на классе `profiles.moderate`. Вес, рост и FTP — не выдаются. `no-store` ставит
 * `PanelGuard`.
 */
@Controller('admin/profiles')
@UseGuards(PanelGuard)
@RequirePermission('profiles.verified_edit')
export class ProfileVerifiedAdminController {
  constructor(private readonly service: ProfileVerifiedAdminService) {}

  @Get(':userId/verified-demographics')
  view(
    @Param('userId', new ZodValidationPipe(Uuid, FieldErrorCode)) userId: string,
  ): Promise<PanelVerifiedDemographics> {
    return this.service.view(userId);
  }

  /** Правка пола и/или года с причиной (журнал — имена полей без значений). */
  @Patch(':userId/verified-demographics')
  update(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', new ZodValidationPipe(Uuid, FieldErrorCode)) userId: string,
    @Body(new ZodValidationPipe(UpdateVerifiedDemographicsRequest, FieldErrorCode))
    body: UpdateVerifiedDemographicsRequest,
  ): Promise<VerifiedDemographicsResult> {
    return this.service.update(actor.userId, userId, body);
  }
}
