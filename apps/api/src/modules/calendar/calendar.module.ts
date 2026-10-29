import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { PublicReadGuard } from '../../public-read.guard';
import { CalendarAdminController } from './calendar-admin.controller';
import { CalendarEventsService } from './calendar-events';
import { CALENDAR_EVENTS } from './calendar-events.port';
import { CalendarOverview } from './calendar-overview';
import { CalendarPublicController } from './calendar-public.controller';
import { CalendarPublicService } from './calendar-public.service';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

/**
 * Ядро `calendar` без HTTP: единственный писатель стартов, порт «Обзора» панели `CalendarOverview` (admin-overview) и
 * порт `CALENDAR_EVENTS` для `tickets` (event-tickets) — только через `index.ts`. Репозиторий объявлен только здесь
 * (один экземпляр).
 */
@Module({
  providers: [
    CalendarRepository,
    CalendarOverview,
    CalendarEventsService,
    { provide: CALENDAR_EVENTS, useExisting: CalendarEventsService },
  ],
  exports: [CalendarRepository, CalendarOverview, CALENDAR_EVENTS],
})
export class CalendarCoreModule {}

/**
 * Календарь стартов (ADR-0010): отдельный контекст, с гонками не связан. Панель — `/v1/admin/calendar` под
 * `PanelGuard`; публичное чтение — без входа. `panel` — только через `modules/panel/index.ts`.
 */
@Module({
  imports: [PanelModule, CalendarCoreModule],
  controllers: [CalendarAdminController, CalendarPublicController],
  providers: [CalendarService, CalendarPublicService, PublicReadGuard],
})
export class CalendarModule {}
