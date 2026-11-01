import { Inject, Injectable } from '@nestjs/common';
import type { CatalogRouteCard } from '@pokatim/contracts';

import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import type { RouteRespectTarget, RoutesForSocial } from './routes-for-social.port';
import { inCatalog, toCatalogCard } from './routes-public.service';
import { RoutesRepository } from './routes.repository';

/**
 * Реализация порта `RoutesForSocial` (P4): видимость — `findInCatalog` (`IN_CATALOG`), автор — только райдер. P7:
 * карточка каталога (`toCatalogCard`, имя автора — `RIDER_NAMES.attributionNames`, как в каталоге).
 */
@Injectable()
export class RoutesForSocialService implements RoutesForSocial {
  constructor(
    private readonly repository: RoutesRepository,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async recentByAuthors(
    authorIds: readonly string[],
    since: Date,
    limit: number,
  ): Promise<{ card: CatalogRouteCard; authorUserId: string }[]> {
    const routes = (await this.repository.recentRiderCatalog(authorIds, since, limit)).filter(
      inCatalog,
    );
    if (routes.length === 0) return [];
    const names = await this.names.attributionNames(routes.map((route) => route.ownerUserId));
    return routes.map((route) => ({
      card: toCatalogCard(route, names),
      authorUserId: route.ownerUserId,
    }));
  }

  async respectTarget(routeId: string): Promise<RouteRespectTarget | null> {
    const route = await this.repository.findInCatalog(routeId);
    if (!route || route.origin !== 'rider') return null;
    return { routeId: route._id, authorUserId: route.ownerUserId };
  }
}
