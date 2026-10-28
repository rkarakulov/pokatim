import { Injectable } from '@nestjs/common';

import type { RideRouteRef, RideRoutes } from './ride-routes.port';
import { type RideRouteFields, RoutesRepository } from './routes.repository';

/** Ссылка на маршрут; документ без старта или длины (у `ready` их нет только по ошибке) — `null`. */
function refOf(route: RideRouteFields, access: RideRouteRef['access']): RideRouteRef | null {
  if (!route.start || route.distanceM === null) return null;
  return {
    id: route._id,
    title: route.title,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    start: route.start.coordinates,
    access,
  };
}

const intoMap = (
  into: Map<string, RideRouteRef>,
  routes: readonly RideRouteFields[],
  access: RideRouteRef['access'],
) => {
  for (const route of routes) {
    const ref = refOf(route, access);
    if (ref) into.set(ref.id, ref);
  }
};

/**
 * Реализация порта `RideRoutes` (05c): без кэша — снятие с публикации, скрытие и удаление видны следующим чтением
 * (8.1 RC-1). Видимость — только запросы `RoutesRepository` (`IN_CATALOG`, `ownRider`).
 */
@Injectable()
export class RideRoutesService implements RideRoutes {
  constructor(private readonly repository: RoutesRepository) {}

  async attachable(routeId: string, organizerUserId: string): Promise<RideRouteRef | null> {
    const [inCatalog] = await this.repository.inCatalogByIds([routeId]);
    if (inCatalog) return refOf(inCatalog, 'public');
    const own = await this.repository.findOwnReady(organizerUserId, routeId);
    return own ? refOf(own, 'private') : null;
  }

  async visible(
    routeIds: readonly string[],
    ownerUserId: string | null,
  ): Promise<Map<string, RideRouteRef>> {
    const result = new Map<string, RideRouteRef>();
    const ids = [...new Set(routeIds)];
    if (ids.length === 0) return result;
    intoMap(result, await this.repository.inCatalogByIds(ids), 'public');
    const rest = ids.filter((id) => !result.has(id));
    if (ownerUserId !== null && rest.length > 0) {
      intoMap(result, await this.repository.ownReadyByIds(ownerUserId, rest), 'private');
    }
    return result;
  }

  ownedRouteIds(userId: string): Promise<string[]> {
    return this.repository.ownIds(userId);
  }

  async existing(routeIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(routeIds)];
    return new Set(ids.length === 0 ? [] : await this.repository.existingIds(ids));
  }
}
