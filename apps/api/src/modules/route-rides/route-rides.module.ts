import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { RouteRideCheckProcessor } from './route-ride-check.processor';
import { RouteRideErasure } from './route-ride-erasure';
import { RouteRidesController } from './route-rides.controller';
import { RouteRidesReadService } from './route-rides-read.service';
import { RouteRidesRepository } from './route-rides.repository';
import { RouteRidesService } from './route-rides.service';

/**
 * Ядро `route-rides` (route-rides-01) для API и worker: репозиторий и порт стирания. Другие модули — только через их
 * `index.ts`: порт `routes` `RouteRideRoutes` (видимость маршрута, линия сверки) и порт `tracks` `ActivitySource`;
 * `routes`/`tracks` о `route-rides` не знают.
 */
@Module({
  imports: [RoutesCoreModule, TracksCoreModule],
  providers: [RouteRidesRepository, RouteRideErasure],
  exports: [RoutesCoreModule, TracksCoreModule, RouteRidesRepository, RouteRideErasure],
})
export class RouteRidesCoreModule {}

/** HTTP: заезды по маршруту (`AuthGuard`). */
@Module({
  imports: [IdentityModule, RouteRidesCoreModule],
  controllers: [RouteRidesController],
  providers: [RouteRidesService, RouteRidesReadService],
})
export class RouteRidesModule {}

/** Задачи `route-rides` в worker: сверка заезда с маршрутом (поток разбора). */
@Module({
  imports: [RouteRidesCoreModule, BullModule.registerQueue({ name: QUEUE.routeRideCheck })],
  providers: [RouteRideCheckProcessor],
})
export class RouteRidesWorkerModule {}
