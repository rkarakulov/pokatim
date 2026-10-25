import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { CalendarAdminController } from './calendar-admin.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

/**
 * Календарь стартов (ADR-0010): отдельный контекст, с гонками не связан. Панель — `/v1/admin/calendar` под
 * `PanelGuard`; публичное чтение — без входа. `panel` — только через `modules/panel/index.ts`.
 */
@Module({
  imports: [PanelModule],
  controllers: [CalendarAdminController],
  providers: [CalendarRepository, CalendarService],
})
export class CalendarModule {}
