import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CheckInRequest, type CheckInView, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { CheckInService } from './check-in.service';

const bodyPipe = new ZodValidationPipe(CheckInRequest, FieldErrorCode);

/**
 * Check-in в панели (`tickets.checkin`: admin, organizer): проверка билета без отметки (`lookup`) и отметка. Бизнес-
 * исходы (уже отмечен, отменён, вне окна) — `200` с `outcome`; нет билета или чужое событие — `404`.
 */
@Controller('admin/tickets')
@UseGuards(PanelGuard)
@RequirePermission('tickets.checkin')
export class CheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  @Post('lookup')
  @HttpCode(200)
  lookup(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Body(bodyPipe) body: CheckInRequest,
  ): Promise<CheckInView> {
    return this.checkIn.lookup(principal, body);
  }

  @Post('check-in')
  @HttpCode(200)
  mark(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Body(bodyPipe) body: CheckInRequest,
  ): Promise<CheckInView> {
    return this.checkIn.checkIn(principal, body);
  }
}
