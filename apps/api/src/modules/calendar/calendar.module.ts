import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { PublicReadGuard } from '../../public-read.guard';
import { CalendarAdminController } from './calendar-admin.controller';
import { CalendarPublicController } from './calendar-public.controller';
import { CalendarPublicService } from './calendar-public.service';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

/**
 * Календарь стартов (ADR-0010): отдельный контекст, с гонками не связан. Панель — `/v1/admin/calendar` под
 * `PanelGuard`; публичное чтение — без входа. `panel` — только через `modules/panel/index.ts`.
 */
@Module({
  imports: [PanelModule],
  controllers: [CalendarAdminController, CalendarPublicController],
  providers: [CalendarRepository, CalendarService, CalendarPublicService, PublicReadGuard],
})
export class CalendarModule {}
