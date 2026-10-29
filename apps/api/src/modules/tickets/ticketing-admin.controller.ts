import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  AdminEventParams,
  type EventTicketingSettings,
  EventTicketingUpdate,
  type EventTicketsPage,
  EventTicketsQuery,
  FieldErrorCode,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { TicketingAdminService } from './ticketing-admin.service';

const paramsPipe = new ZodValidationPipe(AdminEventParams, FieldErrorCode);

/**
 * Билеты события в панели (event-tickets). Настройки — `PanelGuard` без права на маршруте: право зависит от `kind`
 * (`races.manage` своих / `calendar.manage`), проверка — `TicketingAdminService` (RC-T9). Участники — ещё
 * `tickets.checkin` (имена участников — служебный просмотр с правом).
 */
@Controller('admin/events')
@UseGuards(PanelGuard)
export class TicketingAdminController {
  constructor(private readonly ticketing: TicketingAdminService) {}

  @Get(':kind/:eventId/ticketing')
  get(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
  ): Promise<EventTicketingSettings> {
    return this.ticketing.get(principal, params.kind, params.eventId);
  }

  @Put(':kind/:eventId/ticketing')
  update(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
    @Body(new ZodValidationPipe(EventTicketingUpdate, FieldErrorCode)) body: EventTicketingUpdate,
  ): Promise<EventTicketingSettings> {
    return this.ticketing.update(principal, params.kind, params.eventId, body);
  }

  @Get(':kind/:eventId/tickets')
  @RequirePermission('tickets.checkin')
  participants(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
    @Query(new ZodValidationPipe(EventTicketsQuery, FieldErrorCode)) query: EventTicketsQuery,
  ): Promise<EventTicketsPage> {
    return this.ticketing.participants(principal, params.kind, params.eventId, query);
  }
}
