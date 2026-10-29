import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type MyTicketRef, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RaceTickets } from './race-tickets';

/** Свой билет гонки (ленивый выпуск): приложение зовёт сразу после «Участвовать». `no-store`. */
@Controller('races')
@UseGuards(AuthGuard)
export class RaceTicketController {
  constructor(private readonly raceTickets: RaceTickets) {}

  @Get(':raceId/ticket')
  @Header('Cache-Control', 'no-store')
  myTicket(
    @CurrentUser() user: AuthUser,
    @Param('raceId', new ZodValidationPipe(Uuid, FieldErrorCode)) raceId: string,
  ): Promise<MyTicketRef | null> {
    return this.raceTickets.myTicket(user.userId, raceId);
  }
}
