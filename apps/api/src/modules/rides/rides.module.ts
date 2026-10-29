import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { RoutesCoreModule } from '../routes';
import { PublicReadGuard } from '../../public-read.guard';
import { ProfileRidesController } from './profile-rides.controller';
import { RideErasure } from './ride-erasure';
import { RiderRidesService } from './rider-rides';
import { RIDER_RIDES } from './rider-rides.port';
import { RideNoticesService } from './ride-notices';
import { RidesForSharingService } from './rides-for-sharing';
import { RIDES_FOR_SHARING } from './rides-for-sharing.port';
import { RIDE_NOTICES } from './ride-notices.port';
import { RideReportsRepository } from './ride-reports.repository';
import { RideReportsService } from './ride-reports.service';
import { RidesModerationController } from './rides-moderation.controller';
import { RidesModerationService } from './rides-moderation.service';
import { RidesPublicController } from './rides-public.controller';
import { RidesController } from './rides.controller';
import { RidesFeedService } from './rides-feed.service';
import { RidesHistoryService } from './rides-history.service';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

/**
 * Ядро `rides` без HTTP: единственные писатели райдов и жалоб, порт стирания `RideErasure` (модуль
 * `account`, worker), порт получателей уведомлений `RIDE_NOTICES` (`notifications`, ADR-0017) и порт карточки-приглашения
 * `RIDES_FOR_SHARING` (`sharing`, ADR-0018), порт прошедших райдов райдера `RIDER_RIDES` (`achievements`). Импортирует и
 * реэкспортирует `RoutesCoreModule` (05c): порт `RIDE_ROUTES` нужен `RideErasure` здесь и сервисам `RidesModule`
 * (транзитивного импорта в Nest нет); routes от rides не зависит — цикла нет.
 */
@Module({
  imports: [RoutesCoreModule],
  providers: [
    RidesRepository,
    RideReportsRepository,
    RideErasure,
    RideNoticesService,
    { provide: RIDE_NOTICES, useExisting: RideNoticesService },
    RidesForSharingService,
    { provide: RIDES_FOR_SHARING, useExisting: RidesForSharingService },
    RiderRidesService,
    { provide: RIDER_RIDES, useExisting: RiderRidesService },
  ],
  exports: [
    RidesRepository,
    RideReportsRepository,
    RideErasure,
    RIDE_NOTICES,
    RIDES_FOR_SHARING,
    RIDER_RIDES,
    RoutesCoreModule,
  ],
})
export class RidesCoreModule {}

/**
 * Кофе-райды (блок 05, ADR-0013 Proposed): райдер создаёт райд, другие отмечаются «Я иду». Авторизованная часть —
 * `AuthGuard` identity (контроллер — первым); публичная карточка — `PublicReadGuard`. Модерация (05b) — панель
 * `/v1/admin/rides` под `PanelGuard` (`panel` — только через `modules/panel/index.ts`, ADR-0013 п. 1).
 */
@Module({
  imports: [IdentityModule, PanelModule, RidesCoreModule],
  controllers: [
    RidesController,
    RidesPublicController,
    RidesModerationController,
    ProfileRidesController,
  ],
  providers: [
    RideReportsService,
    RidesService,
    RidesFeedService,
    RidesHistoryService,
    RidesModerationService,
    PublicReadGuard,
  ],
})
export class RidesModule {}
