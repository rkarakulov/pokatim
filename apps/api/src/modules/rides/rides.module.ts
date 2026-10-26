import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PublicReadGuard } from '../../public-read.guard';
import { RideReportsRepository } from './ride-reports.repository';
import { RidesPublicController } from './rides-public.controller';
import { RidesController } from './rides.controller';
import { RidesFeedService } from './rides-feed.service';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

/**
 * Кофе-райды (блок 05, ADR-0013 Proposed): райдер создаёт райд, другие отмечаются «Я иду». Авторизованная часть —
 * `AuthGuard` identity (контроллер — первым); публичная карточка — `PublicReadGuard`. Других модулей не импортирует;
 * модерация (`panel`) — PR 05b.
 */
@Module({
  imports: [IdentityModule],
  controllers: [RidesController, RidesPublicController],
  providers: [
    RidesRepository,
    RideReportsRepository,
    RidesService,
    RidesFeedService,
    PublicReadGuard,
  ],
})
export class RidesModule {}
