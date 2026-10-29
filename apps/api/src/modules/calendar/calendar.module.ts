import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { PublicReadGuard } from '../../public-read.guard';
import { CalendarAdminController } from './calendar-admin.controller';
import { CalendarOverview } from './calendar-overview';
import { CalendarPublicController } from './calendar-public.controller';
import { CalendarPublicService } from './calendar-public.service';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

/**
 * Ядро `calendar` без HTTP: единственный писатель стартов и порт «Обзора» панели `CalendarOverview` (admin-overview,
 * только через `index.ts`). Репозиторий объявлен только здесь (один экземпляр).
 */
@Module({
  providers: [CalendarRepository, CalendarOverview],
  exports: [CalendarRepository, CalendarOverview],
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
