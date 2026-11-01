import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type RideParticipants, RideThanksRequest, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { SocialRideParticipantsService } from './ride-participants.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const thanksPipe = new ZodValidationPipe(RideThanksRequest.optional(), FieldErrorCode);

/**
 * Участники райда и ручная явка (P2, ADR-0027 п. 3): префикс чужого ресурса `rides`, данные — у `social`. `AuthGuard`,
 * `no-store`; мутации явки без тела (как `join`/`leave`), «спасибо» (P4) — `{ publicId? }`. Пути `:id/participants`,
 * `:id/attendance*` и `:id/thanks` с публичным `rides/:id` и `rides/:id/me` не пересекаются.
 */
@Controller('rides')
@UseGuards(AuthGuard)
export class RideParticipantsController {
  constructor(private readonly participants: SocialRideParticipantsService) {}

  @Get(':id/participants')
  @Header('Cache-Control', 'no-store')
  view(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideParticipants> {
    return this.participants.view(user.userId, id);
  }

  /** «Я был на райде». */
  @Post(':id/attendance')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  mark(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideParticipants> {
    return this.participants.mark(user.userId, id);
  }

  /** «Меня не было». */
  @Post(':id/attendance/decline')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<RideParticipants> {
    return this.participants.decline(user.userId, id);
  }

  /** «Спасибо за компанию» (P4): с `publicId` — одному явившемуся, без — «Поблагодарить всех». */
  @Post(':id/thanks')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  thank(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(thanksPipe) body: RideThanksRequest | undefined,
  ): Promise<RideParticipants> {
    return this.participants.thank(user.userId, id, body?.publicId);
  }
}
