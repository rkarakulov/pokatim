import { Injectable } from '@nestjs/common';
import type {
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  CatalogRouteQuery,
  RouteMapGeometry,
} from '@pokatim/contracts';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RoutesCatalogService } from './route-catalog';
import type { RouteCatalogDoc, RouteDoc } from './routes.collection';
import { RoutesRepository } from './routes.repository';

/** Маршрут каталога: готовый (длина и петля есть) и опубликованный. */
type CatalogRoute = RouteDoc & { distanceM: number; catalog: RouteCatalogDoc };

const notFound = () => domainError('NOT_FOUND', 404);

const inCatalog = (route: RouteDoc): route is CatalogRoute =>
  route.distanceM !== null && (route.catalog ?? null) !== null;

/** Ответ приложения — явный список полей: без владельца, sha256, статуса, отказа, попыток и линии сверки. */
function toCatalogCard(route: CatalogRoute): CatalogRouteCard {
  return {
    id: route._id,
    title: route.title,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    isLoop: route.isLoop === true,
    city: route.catalog.city,
    surfaces: route.catalog.surfaces,
    publishedAt: route.catalog.publishedAt.toISOString(),
  };
}

/**
 * Публичный каталог маршрутов команды (routes-01): список с фильтрами и курсором `(publishedAt, _id)`, города,
 * карточка и карта. Видимость — одна точка `RoutesRepository.findPublished` (без кэша: каталог изменяем); кэшируется
 * только неизменная геометрия (`RoutesCatalogService.displayGeometry`).
 */
@Injectable()
export class RoutesPublicService {
  constructor(
    private readonly repository: RoutesRepository,
    private readonly geometry: RoutesCatalogService,
  ) {}

  async list(query: CatalogRouteQuery): Promise<CatalogRoutePage> {
    const after = query.cursor ? decodeCursor(query.cursor, z.iso.datetime()) : null;
    const docs = await this.repository.listCatalog(
      { cities: query.city, distance: query.distance, surfaces: query.surface },
      after ? { publishedAt: new Date(after.k), id: after.id } : null,
      query.limit + 1,
    );
    const routes = docs.filter(inCatalog);
    const page = routes.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toCatalogCard),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.catalog.publishedAt.toISOString(), last._id)
          : null,
    };
  }

  async cities(): Promise<CatalogRouteCities> {
    return { cities: await this.repository.catalogCities() };
  }

  async get(id: string): Promise<CatalogRouteDetail> {
    return toCatalogCard(await this.published(id));
  }

  /** Линия показа, старт, финиш и рамка — только маршрута каталога; без коридора и линии сверки. */
  async map(id: string): Promise<RouteMapGeometry> {
    await this.published(id);
    const geometry = await this.geometry.displayGeometry(id);
    if (!geometry) throw notFound();
    return {
      line: geometry.line,
      start: geometry.start,
      finish: geometry.finish,
      bounds: geometry.bounds,
    };
  }

  private async published(id: string): Promise<CatalogRoute> {
    const route = await this.repository.findPublished(id);
    if (!route || !inCatalog(route)) throw notFound();
    return route;
  }
}
