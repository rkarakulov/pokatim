import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type DisputeAgainstMe,
  DisputeFileRequest,
  DisputeResponseRequest,
  FieldErrorCode,
  type MyDispute,
  type MyRaceDisputes,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { DisputesService } from './disputes.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
/** Тело мутаций без данных: пустой объект или без тела (клиент присылает только намерение). */
const EmptyBody = z.strictObject({}).optional();

/**
 * Споры приложения (race-results-06) — только вошедшие, `no-store`; пользователь — из access (`@CurrentUser`).
 * Полные пути: `races/:raceId/disputes` и `disputes/:disputeId/…` (RC-15).
 */
@Controller()
@UseGuards(AuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get('races/:raceId/disputes')
  @Header('Cache-Control', 'no-store')
  mine(
    @CurrentUser() user: AuthUser,
    @Param('raceId', idPipe) raceId: string,
  ): Promise<MyRaceDisputes> {
    return this.disputes.myRaceDisputes(user.userId, raceId);
  }

  @Post('races/:raceId/disputes')
  @Header('Cache-Control', 'no-store')
  file(
    @CurrentUser() user: AuthUser,
    @Param('raceId', idPipe) raceId: string,
    @Body(new ZodValidationPipe(DisputeFileRequest, FieldErrorCode)) body: DisputeFileRequest,
  ): Promise<MyDispute> {
    return this.disputes.file(user.userId, raceId, body);
  }

  @Post('disputes/:disputeId/withdraw')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  withdraw(
    @Body(new ZodValidationPipe(EmptyBody, FieldErrorCode)) _body: unknown,
    @CurrentUser() user: AuthUser,
    @Param('disputeId', idPipe) disputeId: string,
  ): Promise<MyDispute> {
    return this.disputes.withdraw(user.userId, disputeId);
  }

  @Post('disputes/:disputeId/response')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('disputeId', idPipe) disputeId: string,
    @Body(new ZodValidationPipe(DisputeResponseRequest, FieldErrorCode))
    body: DisputeResponseRequest,
  ): Promise<DisputeAgainstMe> {
    return this.disputes.respond(user.userId, disputeId, body);
  }
}
