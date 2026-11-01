import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CatalogRouteAuthor,
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  CatalogRouteQuery,
  RouteExportFormat,
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
import { ROUTE_POLICY, routeExportFormats } from './routes.policy';
import { type RouteDerivedState, RoutesRepository } from './routes.repository';

/** Маршрут каталога: готовый (длина и петля есть) и опубликованный. */
export type CatalogRoute = RouteDoc & { distanceM: number; catalog: RouteCatalogDoc };

const notFound = () => domainError('NOT_FOUND', 404);

const gunzipAsync = promisify(gunzip);

export const inCatalog = (route: RouteDoc): route is CatalogRoute =>
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

/**
 * Ответ приложения — явный список полей: без владельца, sha256, статуса, отказа, попыток и линии сверки. Экспорт —
 * только внутри модуля (`RoutesForSocialService`, social-p7).
 */
export function toCatalogCard(
  route: CatalogRoute,
  names: ReadonlyMap<string, string>,
): CatalogRouteCard {
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
 * Карточка (routes-03): + профиль высоты (мин./макс. — по профилю), признак экспорта GPX и форматы скачивания
 * (routes-formats). Есть `derivedVersion` ⇒ есть экспорт этой версии (одна транзакция, RC-1) — форматы по версии
 * (`routeExportFormats`), без запроса к `route_exports`; `gpxAvailable` ⇔ `'gpx' ∈ exportFormats`.
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
    exportFormats: routeExportFormats(derived?.derivedVersion ?? null),
  };
}

/**
 * Файл экспорта маршрута каталога и название (имя файла); `contentEncoding: 'gzip'` — байты сжаты, ответ с
 * `Content-Encoding: gzip` (route-exports-gzip), `null` — несжатый файл.
 */
export interface CatalogRouteExport {
  bytes: Uint8Array;
  contentEncoding: 'gzip' | null;
  title: string;
}

/**
 * Публичный каталог маршрутов (routes-01; routes-06 — и одобренные маршруты райдеров): список с фильтрами и курсором
 * `(publishedAt, _id)`, города, карточка, карта и файлы экспорта. Видимость — `RoutesRepository.listCatalog`/`findInCatalog`
 * (условие `IN_CATALOG`, без кэша: каталог изменяем). Кэшируется только неизменная геометрия маршрутов **команды**
 * (порт `ROUTE_GEOMETRY`); линия маршрута райдера (удаляемого) читается без кэша.
 */
@Injectable()
export class RoutesPublicService {
  private readonly logger = new Logger(RoutesPublicService.name);

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

  /**
   * Файл экспорта (GPX — routes-03; KML, TCX — routes-formats) — только маршрута каталога; нет экспорта или поля
   * формата (экспорт версии 1) — 404. Разбора и сборки файлов в API нет (route-exports-gzip): сжатый gzip файл —
   * как есть, если клиент принимает gzip (`acceptGzip`), иначе распаковка ≤ `ROUTE_POLICY.exportMaxBytes` (не разбор);
   * старый несжатый документ — как есть. Сбой распаковки — лог `routeId`, формат и класс ошибки, исключение (500).
   */
  async exportFile(
    id: string,
    format: RouteExportFormat,
    acceptGzip: boolean,
  ): Promise<CatalogRouteExport> {
    const route = await this.published(id);
    const stored = await this.repository.exportFile(id, format);
    if (!stored) throw notFound();
    const { title } = route;
    if (!stored.gzip) return { bytes: stored.bytes, contentEncoding: null, title };
    if (acceptGzip) return { bytes: stored.bytes, contentEncoding: 'gzip', title };
    try {
      const bytes = await gunzipAsync(stored.bytes, {
        maxOutputLength: ROUTE_POLICY.exportMaxBytes,
      });
      return { bytes, contentEncoding: null, title };
    } catch (error) {
      // класс ошибки без текста (Z_DATA_ERROR, ERR_BUFFER_TOO_LARGE)
      const kind =
        error instanceof Error
          ? ((error as NodeJS.ErrnoException).code ?? error.name)
          : typeof error;
      this.logger.error(`route ${id} export ${format} unreadable (${kind})`);
      throw error;
    }
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
