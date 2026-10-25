import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  type CalendarCities,
  type CalendarMonths,
  type CalendarPage,
  CalendarQuery,
  type CalendarStartDetail,
  FieldErrorCode,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { CalendarPublicService } from './calendar-public.service';

/** Публичный календарь стартов (Q14, §13): без входа, только опубликованное, кэш 60 с, IP-лимит `public-read`. */
@Controller('calendar')
@UseGuards(PublicReadGuard)
export class CalendarPublicController {
  constructor(private readonly calendar: CalendarPublicService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  list(
    @Query(new ZodValidationPipe(CalendarQuery, FieldErrorCode)) query: CalendarQuery,
  ): Promise<CalendarPage> {
    return this.calendar.list(query);
  }

  // до `:id`: иначе «cities» разбирался бы как id (400)
  @Get('cities')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  cities(): Promise<CalendarCities> {
    return this.calendar.cities();
  }

  // до `:id`, как `cities`
  @Get('months')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  months(): Promise<CalendarMonths> {
    return this.calendar.months();
  }

  @Get(':id')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string,
  ): Promise<CalendarStartDetail> {
    return this.calendar.get(id);
  }
}
