import { Injectable } from '@nestjs/common';
import { boundsOf, haversineMeters, type Bounds } from '@pokatim/tracks';

import type { DbSession } from '../../db';
import type { RouteDoc } from './routes.collection';
import type { ReadyRoute, RouteCatalog } from './route-catalog.port';
import type {
  RouteDisplayGeometry,
  RouteGeometry,
  RouteMatchGeometry,
} from './route-geometry.port';
import { RoutesRepository } from './routes.repository';

/** Готовых маршрутов в кэше процесса (LRU): линия сверки ≤ 20 000 точек ≈ 1 МБ. */
const GEOMETRY_CACHE_MAX = 32;
/** Линий показа в кэше процесса (LRU, карта коридора): ≤ 1000 точек ≈ 25 КБ. */
const DISPLAY_CACHE_MAX = 256;

interface CachedGeometry {
  match: RouteMatchGeometry;
  bounds: Bounds;
}

/**
 * Линия показа, старт, финиш и рамка готового маршрута; `null` — нет концов или линии (< 2 точек). Общая для портов
 * (маршрут платформы) и карты своего маршрута райдера (`MyRoutesService.map`, routes-02).
 */
export function displayGeometryOf(
  route: RouteDoc,
  line: [number, number][] | undefined,
): RouteDisplayGeometry | null {
  if (!route.start || !route.finish) return null;
  const bounds = line ? boundsOf(line) : null;
  if (!line || line.length < 2 || !bounds) return null;
  return { line, start: route.start.coordinates, finish: route.finish.coordinates, bounds };
}

/**
 * Реализация портов `RouteCatalog` и `RouteGeometry`: читает только маршруты платформы (`findReady`, `routesByIds`,
 * `findPublished` — с `origin: 'platform'`, routes-02). Кэш геометрии безопасен: готовый маршрут платформы не
 * меняется и не удаляется (`pokatim-db.md`); маршрут райдера (удаляемый) в кэш не попадает.
 */
@Injectable()
export class RoutesCatalogService implements RouteCatalog, RouteGeometry {
  private readonly cache = new Map<string, CachedGeometry>();
  /** Отдельно от `cache`: показу не нужна линия сверки (≈ 1 МБ на маршрут). */
  private readonly displayCache = new Map<string, RouteDisplayGeometry>();

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

  async inCatalog(id: string): Promise<boolean> {
    return (await this.repository.findPublished(id)) !== undefined;
  }

  async matchGeometry(routeId: string): Promise<RouteMatchGeometry | null> {
    return (await this.cached(routeId))?.match ?? null;
  }

  async bounds(routeId: string): Promise<Bounds | null> {
    return (await this.cached(routeId))?.bounds ?? null;
  }

  async displayGeometry(routeId: string): Promise<RouteDisplayGeometry | null> {
    const hit = this.displayCache.get(routeId);
    if (hit) {
      this.displayCache.delete(routeId);
      this.displayCache.set(routeId, hit);
      return hit;
    }
    const route = await this.repository.findReady(routeId);
    if (!route?.start || !route.finish) return null;
    const entry = displayGeometryOf(route, await this.repository.displayLine(routeId));
    if (!entry) return null;
    this.displayCache.set(routeId, entry);
    if (this.displayCache.size > DISPLAY_CACHE_MAX) {
      const oldest = this.displayCache.keys().next().value;
      if (oldest !== undefined) this.displayCache.delete(oldest);
    }
    return entry;
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
