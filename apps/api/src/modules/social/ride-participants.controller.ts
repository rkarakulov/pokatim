import { Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type RideParticipants, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { SocialRideParticipantsService } from './ride-participants.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Участники райда и ручная явка (P2, ADR-0027 п. 3): префикс чужого ресурса `rides`, данные — у `social`. `AuthGuard`,
 * `no-store`; мутации без тела (как `join`/`leave`). Пути `:id/participants` и `:id/attendance*` с публичным
 * `rides/:id` и `rides/:id/me` не пересекаются.
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
}
