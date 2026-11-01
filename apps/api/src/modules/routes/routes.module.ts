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
import { RouteNoticesService } from './route-notices';
import { ROUTE_NOTICES } from './route-notices.port';
import { RouteReportsRepository } from './route-reports.repository';
import { RideRoutesService } from './ride-routes';
import { RIDE_ROUTES } from './ride-routes.port';
import { RouteRideRoutesService } from './route-ride-routes';
import { ROUTE_RIDE_ROUTES } from './route-ride-routes.port';
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
import { RoutesForSharingService } from './routes-for-sharing';
import { ROUTES_FOR_SHARING } from './routes-for-sharing.port';
import { RoutesForSocialService } from './routes-for-social';
import { ROUTES_FOR_SOCIAL } from './routes-for-social.port';
import { RoutesOverview } from './routes-overview';
import { RoutesPublicService } from './routes-public.service';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';
import { RoutesViewerController } from './routes-viewer.controller';

/**
 * Ядро `routes` для API и worker: репозиторий, порт `RouteCatalog` для `races` и `RouteGeometry` для `results`
 * (через `index.ts`), порт стирания `RouteErasure` для `account`, порт `RouteNotices` для `notifications`, порт
 * `RideRoutes` для `rides` (05c, без кэша), порт `RouteRideRoutes` для `route-rides` (route-rides-01, без кэша); удаление
 * маршрута с жалобами (`RouteDeletion`, routes-06) — общее для «Моих» и стирания; очереди модерации для «Обзора»
 * панели (`RoutesOverview`, admin-overview); порт OG-картинки `RoutesForSharing` для `sharing` (og-images); порт
 * `RoutesForSocial` для `social` («Свои» P4: маршрут райдера в каталоге — цель «Респекта автору»; P7 — новые маршруты
 * «своих», имя автора — `RIDER_NAMES` из `ProfileCoreModule`, у него импортов нет — цикла нет).
 */
@Module({
  imports: [ProfileCoreModule],
  providers: [
    RoutesRepository,
    RouteReportsRepository,
    RouteDeletion,
    RoutesCatalogService,
    { provide: ROUTE_CATALOG, useExisting: RoutesCatalogService },
    { provide: ROUTE_GEOMETRY, useExisting: RoutesCatalogService },
    RouteErasure,
    RouteNoticesService,
    { provide: ROUTE_NOTICES, useExisting: RouteNoticesService },
    RideRoutesService,
    { provide: RIDE_ROUTES, useExisting: RideRoutesService },
    RouteRideRoutesService,
    { provide: ROUTE_RIDE_ROUTES, useExisting: RouteRideRoutesService },
    RoutesOverview,
    RoutesForSharingService,
    { provide: ROUTES_FOR_SHARING, useExisting: RoutesForSharingService },
    RoutesForSocialService,
    { provide: ROUTES_FOR_SOCIAL, useExisting: RoutesForSocialService },
  ],
  exports: [
    RoutesRepository,
    RouteReportsRepository,
    RouteDeletion,
    ROUTE_CATALOG,
    ROUTE_GEOMETRY,
    RouteErasure,
    ROUTE_NOTICES,
    RIDE_ROUTES,
    ROUTE_RIDE_ROUTES,
    RoutesOverview,
    ROUTES_FOR_SHARING,
    ROUTES_FOR_SOCIAL,
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
