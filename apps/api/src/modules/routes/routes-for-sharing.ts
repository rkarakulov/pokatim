import { Injectable } from '@nestjs/common';
import type { LonLat } from '@pokatim/contracts';

import type { ChangedCursor, ChangedRow } from '../../changed-since';
import { RideRoutesService } from './ride-routes';
import type { RouteOgFacts, RoutesForSharing } from './routes-for-sharing.port';
import { RoutesRepository } from './routes.repository';

/**
 * Реализация порта `RoutesForSharing` (OG-картинка): видимость — `findInCatalog` (`IN_CATALOG`, как карточка каталога),
 * линия — `RideRoutesService.catalogLine` (перепроверяет каталог, без кэша).
 */
@Injectable()
export class RoutesForSharingService implements RoutesForSharing {
  constructor(
    private readonly repository: RoutesRepository,
    private readonly rideRoutes: RideRoutesService,
  ) {}

  async ogFacts(routeId: string): Promise<RouteOgFacts | null> {
    const route = await this.repository.findInCatalog(routeId);
    if (!route || route.distanceM === null || !route.catalog) return null;
    return {
      routeId: route._id,
      title: route.title,
      distanceM: route.distanceM,
      elevationGainM: route.elevationGainM,
      isLoop: route.isLoop === true,
      city: route.catalog.city,
    };
  }

  ogLine(routeId: string): Promise<LonLat[] | null> {
    return this.rideRoutes.catalogLine(routeId);
  }

  ogChanged(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    return this.repository.changedForOg(after, limit);
  }

  sitemapAfter(afterId: string | null, limit: number): Promise<ChangedRow[]> {
    return this.repository.sitemapAfter(afterId, limit);
  }
}
