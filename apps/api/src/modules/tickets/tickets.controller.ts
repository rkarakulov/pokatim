import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type MyTickets, TicketCode, type TicketView } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { TicketsReadService } from './tickets-read.service';

/** Свои билеты (event-tickets): только владелец, чужой и несуществующий код — один 404, `no-store`. */
@Controller('tickets')
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsReadService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<MyTickets> {
    return this.tickets.list(user.userId);
  }

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  view(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodValidationPipe(TicketCode, FieldErrorCode)) code: string,
  ): Promise<TicketView> {
    return this.tickets.view(user.userId, code);
  }
}
