import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard, PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { RoutesCatalogService } from './route-catalog';
import { ROUTE_CATALOG } from './route-catalog.port';
import { ROUTE_GEOMETRY } from './route-geometry.port';
import { RouteDerivedBackfill } from './route-derived';
import { RouteProcessingProcessor } from './route-processing.processor';
import { MyRoutesService } from './my-routes.service';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesCatalogAdminService } from './routes-catalog-admin.service';
import { RoutesMineController } from './routes-mine.controller';
import { RoutesPublicController } from './routes-public.controller';
import { RoutesMaintenanceProcessor, RoutesSchedules } from './routes-maintenance.processor';
import { RoutesPublicService } from './routes-public.service';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';

/**
 * Ядро `routes` для API и worker: репозиторий, порт `RouteCatalog` для `races` и `RouteGeometry` для `results`
 * (через `index.ts`).
 */
@Module({
  providers: [
    RoutesRepository,
    RoutesCatalogService,
    { provide: ROUTE_CATALOG, useExisting: RoutesCatalogService },
    { provide: ROUTE_GEOMETRY, useExisting: RoutesCatalogService },
  ],
  exports: [RoutesRepository, ROUTE_CATALOG, ROUTE_GEOMETRY],
})
export class RoutesCoreModule {}

/**
 * HTTP-часть: мои маршруты райдера (routes-02, `AuthGuard` identity; контроллер — первым: `routes/mine` до
 * `routes/:id`); загрузка, чтение и каталог маршрутов в панели (под `PanelGuard`); публичный каталог (routes-01,
 * `PublicReadGuard`). Разбор — только в worker.
 */
@Module({
  imports: [IdentityModule, PanelModule, RoutesCoreModule],
  controllers: [RoutesMineController, RoutesAdminController, RoutesPublicController],
  providers: [
    RoutesService,
    MyRoutesService,
    RoutesCatalogAdminService,
    RoutesPublicService,
    PublicReadGuard,
    IpRateLimitGuard,
  ],
  exports: [RoutesCoreModule],
})
export class RoutesModule {}

/**
 * Задачи `routes` в worker: разбор GPX маршрута (`worker_threads`) и регламент `routes-maintenance` — бэкфилл
 * производных данных (routes-03).
 */
@Module({
  imports: [
    RoutesCoreModule,
    BullModule.registerQueue({ name: QUEUE.routeProcessing }, { name: QUEUE.routesMaintenance }),
  ],
  providers: [
    RouteProcessingProcessor,
    RouteDerivedBackfill,
    RoutesMaintenanceProcessor,
    RoutesSchedules,
  ],
})
export class RoutesWorkerModule {}
