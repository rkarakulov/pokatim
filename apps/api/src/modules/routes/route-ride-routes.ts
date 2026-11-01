import { Injectable } from '@nestjs/common';
import { type Bounds, boundsOf } from '@pokatim/tracks';

import type { RouteMatchGeometry } from './route-geometry.port';
import type { RideableRoute, RouteRideRoutes } from './route-ride-routes.port';
import { RoutesRepository } from './routes.repository';

/** Предел `rideableBounds` за вызов (линии показа ≤ 1000 точек каждая). */
const BOUNDS_BATCH_MAX = 25;
/** Предел `existingIds` за вызов. */
const EXISTING_BATCH_MAX = 1000;

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

  async rideableTitles(routeIds: readonly string[], userId: string): Promise<Map<string, string>> {
    const ids = [...new Set(routeIds)];
    if (ids.length === 0) return new Map();
    const routes = await this.repository.findRideableTitles(userId, ids);
    return new Map(routes.map((route) => [route._id, route.title]));
  }

  ownReadyIds(userId: string, limit: number): Promise<string[]> {
    return this.repository.ownReadyIds(userId, limit);
  }

  async catalogRoute(routeId: string): Promise<{ id: string; title: string } | null> {
    const [route] = await this.repository.inCatalogByIds([routeId]);
    if (!route || route.distanceM === null) return null;
    return { id: route._id, title: route.title };
  }

  async existingIds(routeIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(routeIds)];
    if (ids.length > EXISTING_BATCH_MAX) {
      throw new Error(`existingIds: ${ids.length} ids > ${EXISTING_BATCH_MAX}`);
    }
    return new Set(ids.length === 0 ? [] : await this.repository.existingIds(ids));
  }

  async rideableBounds(routeIds: readonly string[], userId: string): Promise<Map<string, Bounds>> {
    const ids = [...new Set(routeIds)];
    if (ids.length === 0) return new Map();
    if (ids.length > BOUNDS_BATCH_MAX) {
      throw new Error(`rideableBounds: ${ids.length} ids > ${BOUNDS_BATCH_MAX}`);
    }
    const visible = await this.repository.findRideableTitles(userId, ids);
    const lines = await this.repository.displayLines(visible.map((route) => route._id));
    const result = new Map<string, Bounds>();
    for (const route of visible) {
      const line = lines.get(route._id);
      const bounds = line ? boundsOf(line) : null;
      if (bounds) result.set(route._id, bounds);
    }
    return result;
  }
}
