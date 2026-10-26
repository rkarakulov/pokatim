import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { PanelModule } from '../panel';
import { RoutesCatalogService } from './route-catalog';
import { ROUTE_CATALOG } from './route-catalog.port';
import { ROUTE_GEOMETRY } from './route-geometry.port';
import { RouteProcessingProcessor } from './route-processing.processor';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesCatalogAdminService } from './routes-catalog-admin.service';
import { RoutesPublicController } from './routes-public.controller';
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
 * HTTP-часть: загрузка GPX, чтение и каталог маршрутов в панели (под `PanelGuard`); публичный каталог (routes-01,
 * `PublicReadGuard`). Разбор — только в worker.
 */
@Module({
  imports: [PanelModule, RoutesCoreModule],
  controllers: [RoutesAdminController, RoutesPublicController],
  providers: [RoutesService, RoutesCatalogAdminService, RoutesPublicService, PublicReadGuard],
  exports: [RoutesCoreModule],
})
export class RoutesModule {}

/** Задача `routes` в worker: разбор GPX маршрута (`worker_threads`). */
@Module({
  imports: [RoutesCoreModule, BullModule.registerQueue({ name: QUEUE.routeProcessing })],
  providers: [RouteProcessingProcessor],
})
export class RoutesWorkerModule {}
