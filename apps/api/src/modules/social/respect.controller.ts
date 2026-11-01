import { Body, Controller, Get, Header, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type RespectState, SetRespectRequest, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { SocialRespectService } from './respect.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const bodyPipe = new ZodValidationPipe(SetRespectRequest, FieldErrorCode);

/**
 * «Респект» (P4, K8, ADR-0027 п. 3): префиксы чужих ресурсов — строка результата гонки и маршрут; данные — у `social`.
 * `AuthGuard`, `no-store`; `PUT` идемпотентен. С публичными `races/:raceId/results`, `routes/:id`, `routes/:id/me` и
 * `routes/:routeId/rides` не пересекаются — свой статический сегмент `respect`.
 */
@Controller()
@UseGuards(AuthGuard)
export class SocialRespectController {
  constructor(private readonly respect: SocialRespectService) {}

  @Get('races/:raceId/results/:entryId/respect')
  @Header('Cache-Control', 'no-store')
  raceEntry(
    @CurrentUser() user: AuthUser,
    @Param('raceId', idPipe) raceId: string,
    @Param('entryId', idPipe) entryId: string,
  ): Promise<RespectState> {
    return this.respect.raceEntryState(user.userId, raceId, entryId);
  }

  @Put('races/:raceId/results/:entryId/respect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  setRaceEntry(
    @CurrentUser() user: AuthUser,
    @Param('raceId', idPipe) raceId: string,
    @Param('entryId', idPipe) entryId: string,
    @Body(bodyPipe) body: SetRespectRequest,
  ): Promise<RespectState> {
    return this.respect.setRaceEntry(user.userId, raceId, entryId, body.respected);
  }

  @Get('routes/:id/respect')
  @Header('Cache-Control', 'no-store')
  route(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RespectState> {
    return this.respect.routeState(user.userId, id);
  }

  @Put('routes/:id/respect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  setRoute(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(bodyPipe) body: SetRespectRequest,
  ): Promise<RespectState> {
    return this.respect.setRoute(user.userId, id, body.respected);
  }
}
