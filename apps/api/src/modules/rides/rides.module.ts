import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { PublicReadGuard } from '../../public-read.guard';
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
 * Кофе-райды (блок 05, ADR-0013 Proposed): райдер создаёт райд, другие отмечаются «Я иду». Авторизованная часть —
 * `AuthGuard` identity (контроллер — первым); публичная карточка — `PublicReadGuard`. Модерация (05b) — панель
 * `/v1/admin/rides` под `PanelGuard` (`panel` — только через `modules/panel/index.ts`, ADR-0013 п. 1).
 */
@Module({
  imports: [IdentityModule, PanelModule],
  controllers: [RidesController, RidesPublicController, RidesModerationController],
  providers: [
    RidesRepository,
    RideReportsRepository,
    RideReportsService,
    RidesService,
    RidesFeedService,
    RidesModerationService,
    PublicReadGuard,
  ],
})
export class RidesModule {}
