import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { PanelModule } from '../panel';
import { RoutesCatalogService } from './route-catalog';
import { ROUTE_CATALOG } from './route-catalog.port';
import { RouteProcessingProcessor } from './route-processing.processor';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';

/** Ядро `routes` для API и worker: репозиторий и порт `RouteCatalog` для модуля `races` (через `index.ts`). */
@Module({
  providers: [
    RoutesRepository,
    RoutesCatalogService,
    { provide: ROUTE_CATALOG, useExisting: RoutesCatalogService },
  ],
  exports: [RoutesRepository, ROUTE_CATALOG],
})
export class RoutesCoreModule {}

/** HTTP-часть: загрузка GPX и чтение маршрутов в панели (под `PanelGuard`); разбор — только в worker. */
@Module({
  imports: [PanelModule, RoutesCoreModule],
  controllers: [RoutesAdminController],
  providers: [RoutesService],
  exports: [RoutesCoreModule],
})
export class RoutesModule {}

/** Задача `routes` в worker: разбор GPX маршрута (`worker_threads`). */
@Module({
  imports: [RoutesCoreModule, BullModule.registerQueue({ name: QUEUE.routeProcessing })],
  providers: [RouteProcessingProcessor],
})
export class RoutesWorkerModule {}
