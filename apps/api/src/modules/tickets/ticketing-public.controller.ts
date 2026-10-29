import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { AdminEventParams, type EventTicketingPublic, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { TicketingPublicService } from './ticketing-public.service';

/** Публичная сводка регистрации события (RC-T7): без входа, кэш 60 с, IP-лимит `public-read`. */
@Controller('events')
@UseGuards(PublicReadGuard)
export class TicketingPublicController {
  constructor(private readonly ticketing: TicketingPublicService) {}

  @Get(':kind/:eventId/ticketing')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(
    @Param(new ZodValidationPipe(AdminEventParams, FieldErrorCode)) params: AdminEventParams,
  ): Promise<EventTicketingPublic> {
    return this.ticketing.get(params.kind, params.eventId);
  }
}
