import { Injectable } from '@nestjs/common';

import type { RouteRespectTarget, RoutesForSocial } from './routes-for-social.port';
import { RoutesRepository } from './routes.repository';

/** Реализация порта `RoutesForSocial` (P4): видимость — `findInCatalog` (`IN_CATALOG`), автор — только райдер. */
@Injectable()
export class RoutesForSocialService implements RoutesForSocial {
  constructor(private readonly repository: RoutesRepository) {}

  async respectTarget(routeId: string): Promise<RouteRespectTarget | null> {
    const route = await this.repository.findInCatalog(routeId);
    if (!route || route.origin !== 'rider') return null;
    return { routeId: route._id, authorUserId: route.ownerUserId };
  }
}
