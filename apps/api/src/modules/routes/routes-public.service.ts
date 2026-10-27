import { Inject, Injectable } from '@nestjs/common';
import type {
  CatalogRouteAuthor,
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
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { displayGeometryOf } from './route-catalog';
import { elevationOf } from './route-elevation';
import { ROUTE_GEOMETRY, type RouteGeometry } from './route-geometry.port';
import type { RouteCatalogDoc, RouteDoc } from './routes.collection';
import { type RouteDerivedState, RoutesRepository } from './routes.repository';

/** Маршрут каталога: готовый (длина и петля есть) и опубликованный. */
type CatalogRoute = RouteDoc & { distanceM: number; catalog: RouteCatalogDoc };

const notFound = () => domainError('NOT_FOUND', 404);

const inCatalog = (route: RouteDoc): route is CatalogRoute =>
  route.distanceM !== null && (route.catalog ?? null) !== null;

/**
 * Подпись автора (routes-06, U3): маршрут команды; маршрут райдера — имя только при галочке заявки и заданном имени
 * (`names` — `RIDER_NAMES.attributionNames`, читается на каждом запросе — смена имени видна в пределах кэша 60 с).
 */
function authorOf(route: RouteDoc, names: ReadonlyMap<string, string>): CatalogRouteAuthor {
  if (route.origin !== 'rider') return { kind: 'team' };
  const signed = route.publication?.showAuthorName === true;
  return { kind: 'rider', name: signed ? (names.get(route.ownerUserId) ?? null) : null };
}

/** Авторы-райдеры, согласившиеся на подпись (один запрос имён на страницу). */
const signedAuthors = (routes: readonly RouteDoc[]) =>
  routes
    .filter((route) => route.origin === 'rider' && route.publication?.showAuthorName === true)
    .map((route) => route.ownerUserId);

/** Ответ приложения — явный список полей: без владельца, sha256, статуса, отказа, попыток и линии сверки. */
function toCatalogCard(route: CatalogRoute, names: ReadonlyMap<string, string>): CatalogRouteCard {
  return {
    id: route._id,
    title: route.title,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    isLoop: route.isLoop === true,
    city: route.catalog.city,
    surfaces: route.catalog.surfaces,
    publishedAt: route.catalog.publishedAt.toISOString(),
    author: authorOf(route, names),
  };
}

/**
 * Карточка (routes-03): + профиль высоты (мин./макс. — по профилю) и признак экспорта GPX. Есть `derivedVersion` ⇒
 * есть экспорт (одна транзакция, RC-1) — без запроса к `route_exports`.
 */
function toCatalogDetail(
  route: CatalogRoute,
  derived: RouteDerivedState | undefined,
  names: ReadonlyMap<string, string>,
): CatalogRouteDetail {
  return {
    ...toCatalogCard(route, names),
    elevation: elevationOf(derived?.profile ?? null),
    gpxAvailable: (derived?.derivedVersion ?? null) !== null,
  };
}

/** Очищенный GPX маршрута каталога и название (имя файла). */
export interface CatalogRouteGpx {
  bytes: Uint8Array;
  title: string;
}

/**
 * Публичный каталог маршрутов (routes-01; routes-06 — и одобренные маршруты райдеров): список с фильтрами и курсором
 * `(publishedAt, _id)`, города, карточка, карта и GPX. Видимость — `RoutesRepository.listCatalog`/`findInCatalog`
 * (условие `IN_CATALOG`, без кэша: каталог изменяем). Кэшируется только неизменная геометрия маршрутов **команды**
 * (порт `ROUTE_GEOMETRY`); линия маршрута райдера (удаляемого) читается без кэша.
 */
@Injectable()
export class RoutesPublicService {
  constructor(
    private readonly repository: RoutesRepository,
    /** `RoutesCatalogService.displayGeometry` (кэш неизменной геометрии) через тот же порт, что у `races`. */
    @Inject(ROUTE_GEOMETRY) private readonly geometry: RouteGeometry,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async list(query: CatalogRouteQuery): Promise<CatalogRoutePage> {
    const after = query.cursor ? decodeCursor(query.cursor, z.iso.datetime()) : null;
    const docs = await this.repository.listCatalog(
      {
        cities: query.city,
        distance: query.distance,
        surfaces: query.surface,
        authors: query.author,
      },
      after ? { publishedAt: new Date(after.k), id: after.id } : null,
      query.limit + 1,
    );
    const routes = docs.filter(inCatalog);
    const page = routes.slice(0, query.limit);
    const last = page.at(-1);
    const names = await this.names.attributionNames(signedAuthors(page));
    return {
      items: page.map((route) => toCatalogCard(route, names)),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.catalog.publishedAt.toISOString(), last._id)
          : null,
    };
  }

  async cities(): Promise<CatalogRouteCities> {
    return { cities: await this.repository.catalogCities() };
  }

  /** Карточка: профиль — чтением по `_id` без кэша в процессе (RC-4: устаревание — только HTTP-кэш, ≤ 60 с). */
  async get(id: string): Promise<CatalogRouteDetail> {
    const route = await this.published(id);
    const names = await this.names.attributionNames(signedAuthors([route]));
    return toCatalogDetail(route, await this.repository.derivedOf(id), names);
  }

  /** Очищенный GPX (routes-03) — только маршрута каталога; нет экспорта — 404. Разбора в API нет. */
  async gpx(id: string): Promise<CatalogRouteGpx> {
    const route = await this.published(id);
    const bytes = await this.repository.exportGpx(id);
    if (!bytes) throw notFound();
    return { bytes, title: route.title };
  }

  /**
   * Линия показа, старт, финиш и рамка — только маршрута каталога; без коридора и линии сверки. Маршрут команды —
   * через порт (кэш неизменной геометрии), маршрут райдера — чтением без кэша (его можно удалить).
   */
  async map(id: string): Promise<RouteMapGeometry> {
    const route = await this.published(id);
    const geometry =
      route.origin === 'platform'
        ? await this.geometry.displayGeometry(id)
        : displayGeometryOf(route, await this.repository.displayLine(id));
    if (!geometry) throw notFound();
    return {
      line: geometry.line,
      start: geometry.start,
      finish: geometry.finish,
      bounds: geometry.bounds,
    };
  }

  private async published(id: string): Promise<CatalogRoute> {
    const route = await this.repository.findInCatalog(id);
    if (!route || !inCatalog(route)) throw notFound();
    return route;
  }
}
