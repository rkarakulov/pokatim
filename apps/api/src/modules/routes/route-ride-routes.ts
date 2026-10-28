import { Injectable } from '@nestjs/common';
import { boundsOf } from '@pokatim/tracks';

import type { RouteMatchGeometry } from './route-geometry.port';
import type { RideableRoute, RouteRideRoutes } from './route-ride-routes.port';
import { RoutesRepository } from './routes.repository';

/**
 * Реализация порта `RouteRideRoutes` (route-rides-01): видимость — только запрос `RoutesRepository.findRideable`
 * (`IN_CATALOG` или `ownRider`), без кэша — снятие с публикации, скрытие и удаление видны следующим вызовом.
 */
@Injectable()
export class RouteRideRoutesService implements RouteRideRoutes {
  constructor(private readonly repository: RoutesRepository) {}

  async rideable(routeId: string, userId: string): Promise<RideableRoute | null> {
    const route = await this.repository.findRideable(userId, routeId);
    if (!route || route.distanceM === null) return null;
    const line = await this.repository.displayLine(routeId);
    const bounds = line ? boundsOf(line) : null;
    if (!bounds) return null;
    return {
      id: route._id,
      title: route.title,
      distanceM: route.distanceM,
      isLoop: route.isLoop === true,
      bounds,
      access: route.origin === 'rider' && route.ownerUserId === userId ? 'own' : 'catalog',
    };
  }

  async matchGeometry(routeId: string, userId: string): Promise<RouteMatchGeometry | null> {
    const route = await this.repository.findRideable(userId, routeId);
    if (!route || route.distanceM === null) return null;
    const geometry = await this.repository.geometry(routeId);
    if (!geometry) return null;
    return { line: geometry.matchLine, isLoop: route.isLoop === true, distanceM: route.distanceM };
  }
}
