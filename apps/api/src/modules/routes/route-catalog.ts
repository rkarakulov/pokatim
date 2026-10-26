import { Injectable } from '@nestjs/common';
import { boundsOf, haversineMeters, type Bounds } from '@pokatim/tracks';

import type { DbSession } from '../../db';
import type { ReadyRoute, RouteCatalog } from './route-catalog.port';
import type { RouteGeometry, RouteMatchGeometry } from './route-geometry.port';
import { RoutesRepository } from './routes.repository';

/** Готовых маршрутов в кэше процесса (LRU): линия сверки ≤ 20 000 точек ≈ 1 МБ. */
const GEOMETRY_CACHE_MAX = 32;

interface CachedGeometry {
  match: RouteMatchGeometry;
  bounds: Bounds;
}

/**
 * Реализация портов `RouteCatalog` и `RouteGeometry`: читает только `routes`/`route_geometries`. Кэш геометрии
 * безопасен: готовый маршрут не меняется и не удаляется (`pokatim-db.md`).
 */
@Injectable()
export class RoutesCatalogService implements RouteCatalog, RouteGeometry {
  private readonly cache = new Map<string, CachedGeometry>();

  constructor(private readonly repository: RoutesRepository) {}

  async findReady(id: string, tx?: DbSession): Promise<ReadyRoute | null> {
    const route = await this.repository.findReady(id, tx);
    if (!route || route.distanceM === null || !route.start || !route.finish) return null;
    const [startLon, startLat] = route.start.coordinates;
    const [finishLon, finishLat] = route.finish.coordinates;
    return {
      id: route._id,
      title: route.title,
      distanceM: route.distanceM,
      isLoop: route.isLoop === true,
      endsDistanceM: haversineMeters(
        { lon: startLon, lat: startLat },
        { lon: finishLon, lat: finishLat },
      ),
    };
  }

  async summaries(ids: readonly string[]): Promise<Map<string, { title: string }>> {
    const routes = await this.repository.routesByIds([...new Set(ids)]);
    return new Map(routes.map((route) => [route._id, { title: route.title }]));
  }

  async matchGeometry(routeId: string): Promise<RouteMatchGeometry | null> {
    return (await this.cached(routeId))?.match ?? null;
  }

  async bounds(routeId: string): Promise<Bounds | null> {
    return (await this.cached(routeId))?.bounds ?? null;
  }

  private async cached(routeId: string): Promise<CachedGeometry | null> {
    const hit = this.cache.get(routeId);
    if (hit) {
      this.cache.delete(routeId);
      this.cache.set(routeId, hit);
      return hit;
    }
    const route = await this.repository.findReady(routeId);
    if (!route || route.distanceM === null) return null;
    const geometry = await this.repository.geometry(routeId);
    const bounds = geometry ? boundsOf(geometry.line.coordinates) : null;
    if (!geometry || !bounds) return null;
    const entry: CachedGeometry = {
      match: {
        line: geometry.matchLine,
        isLoop: route.isLoop === true,
        distanceM: route.distanceM,
      },
      bounds,
    };
    this.cache.set(routeId, entry);
    if (this.cache.size > GEOMETRY_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return entry;
  }
}
