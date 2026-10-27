import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { PublicReadGuard } from '../../public-read.guard';
import { RideErasure } from './ride-erasure';
import { RideNoticesService } from './ride-notices';
import { RIDE_NOTICES } from './ride-notices.port';
import { RideReportsRepository } from './ride-reports.repository';
import { RideReportsService } from './ride-reports.service';
import { RidesModerationController } from './rides-moderation.controller';
import { RidesModerationService } from './rides-moderation.service';
import { RidesPublicController } from './rides-public.controller';
import { RidesController } from './rides.controller';
import { RidesFeedService } from './rides-feed.service';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

/**
 * Ядро `rides` без HTTP: единственные писатели райдов и жалоб, порт стирания `RideErasure` (модуль
 * `account`, worker) и порт получателей уведомлений `RIDE_NOTICES` (`notifications`, ADR-0016).
 */
@Module({
  providers: [
    RidesRepository,
    RideReportsRepository,
    RideErasure,
    RideNoticesService,
    { provide: RIDE_NOTICES, useExisting: RideNoticesService },
  ],
  exports: [RidesRepository, RideReportsRepository, RideErasure, RIDE_NOTICES],
})
export class RidesCoreModule {}

/**
 * Кофе-райды (блок 05, ADR-0013 Proposed): райдер создаёт райд, другие отмечаются «Я иду». Авторизованная часть —
 * `AuthGuard` identity (контроллер — первым); публичная карточка — `PublicReadGuard`. Модерация (05b) — панель
 * `/v1/admin/rides` под `PanelGuard` (`panel` — только через `modules/panel/index.ts`, ADR-0013 п. 1).
 */
@Module({
  imports: [IdentityModule, PanelModule, RidesCoreModule],
  controllers: [RidesController, RidesPublicController, RidesModerationController],
  providers: [
    RideReportsService,
    RidesService,
    RidesFeedService,
    RidesModerationService,
    PublicReadGuard,
  ],
})
export class RidesModule {}
