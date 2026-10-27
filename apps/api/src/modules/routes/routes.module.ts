import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard, PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { RoutesCatalogService } from './route-catalog';
import { ROUTE_CATALOG } from './route-catalog.port';
import { ROUTE_GEOMETRY } from './route-geometry.port';
import { RouteDerivedBackfill } from './route-derived';
import { RouteDeletion } from './route-deletion';
import { RouteErasure } from './route-erasure';
import { RouteReportsRepository } from './route-reports.repository';
import { RouteReportsService } from './route-reports.service';
import { RouteProcessingProcessor } from './route-processing.processor';
import { MyRoutePublicationService } from './my-route-publication.service';
import { MyRoutesService } from './my-routes.service';
import { RoutesAdminController } from './routes-admin.controller';
import { RoutesCatalogAdminService } from './routes-catalog-admin.service';
import { RoutesMineController } from './routes-mine.controller';
import { RoutesModerationController } from './routes-moderation.controller';
import { RoutesModerationService } from './routes-moderation.service';
import { RoutesPublicController } from './routes-public.controller';
import { RoutesMaintenanceProcessor, RoutesSchedules } from './routes-maintenance.processor';
import { RoutesPublicService } from './routes-public.service';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';
import { RoutesViewerController } from './routes-viewer.controller';

/**
 * Ядро `routes` для API и worker: репозиторий, порт `RouteCatalog` для `races` и `RouteGeometry` для `results`
 * (через `index.ts`), порт стирания `RouteErasure` для `account`; удаление маршрута с жалобами (`RouteDeletion`,
 * routes-06) — общее для «Моих» и стирания.
 */
@Module({
  providers: [
    RoutesRepository,
    RouteReportsRepository,
    RouteDeletion,
    RoutesCatalogService,
    { provide: ROUTE_CATALOG, useExisting: RoutesCatalogService },
    { provide: ROUTE_GEOMETRY, useExisting: RoutesCatalogService },
    RouteErasure,
  ],
  exports: [
    RoutesRepository,
    RouteReportsRepository,
    RouteDeletion,
    ROUTE_CATALOG,
    ROUTE_GEOMETRY,
    RouteErasure,
  ],
})
export class RoutesCoreModule {}

/**
 * HTTP-часть: мои маршруты райдера (routes-02, `AuthGuard` identity; контроллер — первым: `routes/mine` до
 * `routes/:id`) и их публикация (routes-06); зритель карточки каталога — жалоба и `me` (`AuthGuard`); загрузка, чтение
 * и каталог маршрутов в панели и модерация маршрутов райдеров (под `PanelGuard`); публичный каталог (routes-01,
 * `PublicReadGuard`; имя автора — порт `RIDER_NAMES` из `ProfileCoreModule`). Разбор — только в worker.
 */
@Module({
  imports: [IdentityModule, PanelModule, ProfileCoreModule, RoutesCoreModule],
  controllers: [
    RoutesMineController,
    RoutesViewerController,
    RoutesAdminController,
    RoutesModerationController,
    RoutesPublicController,
  ],
  providers: [
    RoutesService,
    MyRoutesService,
    MyRoutePublicationService,
    RouteReportsService,
    RoutesModerationService,
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
