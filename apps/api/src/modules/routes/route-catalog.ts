import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import type { ReadyRoute, RouteCatalog } from './route-catalog.port';
import { RoutesRepository } from './routes.repository';

/** Реализация порта `RouteCatalog`: читает только `routes`. */
@Injectable()
export class RoutesCatalogService implements RouteCatalog {
  constructor(private readonly repository: RoutesRepository) {}

  async findReady(id: string, tx?: DbSession): Promise<ReadyRoute | null> {
    const route = await this.repository.findReady(id, tx);
    if (!route || route.distanceM === null) return null;
    return { id: route._id, title: route.title, distanceM: route.distanceM };
  }

  async summaries(ids: readonly string[]): Promise<Map<string, { title: string }>> {
    const routes = await this.repository.routesByIds([...new Set(ids)]);
    return new Map(routes.map((route) => [route._id, { title: route.title }]));
  }
}
