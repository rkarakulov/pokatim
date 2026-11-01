import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { RouteRideAutoProcessor } from './route-ride-auto.processor';
import { RouteRideCheckProcessor } from './route-ride-check.processor';
import { RouteRideEvaluator } from './route-ride-evaluator';
import { RouteRideLeaderboardService } from './route-ride-leaderboard.service';
import { RiderRouteRidesService } from './rider-route-rides';
import { RIDER_ROUTE_RIDES } from './rider-route-rides.port';
import { RouteRideErasure } from './route-ride-erasure';
import { RouteRidesIntakeProcessor } from './route-rides-intake.processor';
import {
  RouteRidesMaintenanceProcessor,
  RouteRidesSchedules,
} from './route-rides-maintenance.processor';
import { RouteRidesController } from './route-rides.controller';
import { RouteRidesReadService } from './route-rides-read.service';
import { RouteRidesRepository } from './route-rides.repository';
import { RouteRidesService } from './route-rides.service';

/**
 * Ядро `route-rides` (route-rides-01) для API и worker: репозиторий, порт стирания и порт пройденных заездов
 * `RIDER_ROUTE_RIDES` (`achievements`). Другие модули — только через их
 * `index.ts`: порт `routes` `RouteRideRoutes` (видимость маршрута, линия сверки) и порт `tracks` `ActivitySource`;
 * `routes`/`tracks` о `route-rides` не знают.
 */
@Module({
  imports: [RoutesCoreModule, TracksCoreModule],
  providers: [
    RouteRidesRepository,
    RouteRideErasure,
    RiderRouteRidesService,
    { provide: RIDER_ROUTE_RIDES, useExisting: RiderRouteRidesService },
  ],
  exports: [
    RoutesCoreModule,
    TracksCoreModule,
    RouteRidesRepository,
    RouteRideErasure,
    RIDER_ROUTE_RIDES,
  ],
})
export class RouteRidesCoreModule {}

/**
 * HTTP: заезды по маршруту (`AuthGuard`). Таблица «Другие» (route-rides-04) — порт `profile` `RIDER_NAMES` через
 * `ProfileCoreModule` (только здесь: ядро, worker, `account` и `achievements` о `profile` не знают).
 */
@Module({
  imports: [IdentityModule, ProfileCoreModule, RouteRidesCoreModule],
  controllers: [RouteRidesController],
  providers: [RouteRidesService, RouteRidesReadService, RouteRideLeaderboardService],
})
export class RouteRidesModule {}

/**
 * Задачи `route-rides` в worker: сверка заезда с маршрутом (поток разбора) — ручная (`route-ride-check`) и автопроверка
 * новой активности (`route-ride-auto`, route-rides-03; сверка — общий `RouteRideEvaluator`), приём
 * `tracks.activity-removed` (`route-rides-intake`, удаление заездов активности), уборщик сирот
 * (`route-rides-maintenance`, route-rides-08).
 */
@Module({
  imports: [
    RouteRidesCoreModule,
    BullModule.registerQueue(
      { name: QUEUE.routeRideCheck },
      { name: QUEUE.routeRidesIntake },
      { name: QUEUE.routeRideAuto },
      { name: QUEUE.routeRidesMaintenance },
    ),
  ],
  providers: [
    RouteRideEvaluator,
    RouteRideCheckProcessor,
    RouteRidesIntakeProcessor,
    RouteRideAutoProcessor,
    RouteRidesMaintenanceProcessor,
    RouteRidesSchedules,
  ],
})
export class RouteRidesWorkerModule {}
