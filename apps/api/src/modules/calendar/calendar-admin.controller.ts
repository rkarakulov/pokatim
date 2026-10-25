import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CalendarStartInput,
  FieldErrorCode,
  type PanelCalendarPage,
  PanelCalendarQuery,
  type PanelCalendarStart,
  RepublishCalendarStartRequest,
  UnpublishCalendarStartRequest,
  UpdateCalendarStartRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { CalendarService } from './calendar.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Календарь» панели (`calendar.manage`, Q2 — только admin). */
@Controller('admin/calendar')
@UseGuards(PanelGuard)
@RequirePermission('calendar.manage')
export class CalendarAdminController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(PanelCalendarQuery, FieldErrorCode)) query: PanelCalendarQuery,
  ): Promise<PanelCalendarPage> {
    return this.calendar.list(query);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<PanelCalendarStart> {
    return this.calendar.get(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(CalendarStartInput, FieldErrorCode)) body: CalendarStartInput,
  ): Promise<PanelCalendarStart> {
    return this.calendar.create(actor.userId, body);
  }

  @Post(':id')
  @HttpCode(200)
  update(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCalendarStartRequest, FieldErrorCode))
    body: UpdateCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    return this.calendar.update(actor.userId, id, body);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UnpublishCalendarStartRequest, FieldErrorCode))
    body: UnpublishCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    return this.calendar.unpublish(actor.userId, id, body);
  }

  @Post(':id/republish')
  @HttpCode(200)
  republish(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RepublishCalendarStartRequest, FieldErrorCode))
    body: RepublishCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    return this.calendar.republish(actor.userId, id, body);
  }
}
