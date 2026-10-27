import type { CityCode, RouteFailureCode, RouteStatus, Surface } from '@pokatim/contracts';
import type { Binary, Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `routes` — эталонные маршруты коридора гонки (race-results-01, ADR-0012 п. 1). Создаёт миграция
 * `0013_routes`; единственный писатель — `RoutesRepository`. Готовый маршрут (`ready`) не меняется: ни линия, ни
 * длина (гонки хранят `routeId` и снимок длины). Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным `null`.
 */
export const ROUTES_COLLECTIONS = {
  routes: 'routes',
  geometries: 'route_geometries',
  sources: 'route_sources',
  /** очищенный GPX маршрута для скачивания (routes-03) */
  exports: 'route_exports',
} as const;

/**
 * Публикация маршрута в каталоге (routes-01): изменяемые метаданные готового маршрута, на коридоры гонок не влияют.
 * `publishedAt` — момент публикации (правка города/покрытия его не меняет, повторная публикация после снятия — новый).
 */
export interface RouteCatalogDoc {
  city: CityCode;
  surfaces: Surface[];
  publishedAt: Date;
}

/** Маршрут: v1 — только маршруты команды платформы (`origin: 'platform'`). Уникальны `(ownerUserId, sha256)`. */
export interface RouteDoc {
  _id: string;
  origin: 'platform';
  ownerUserId: string;
  title: string;
  status: RouteStatus;
  failure: RouteFailureCode | null;
  attempts: number;
  sha256: string;
  sizeBytes: number;
  distanceM: number | null;
  elevationGainM: number | null;
  isLoop: boolean | null;
  start: { type: 'Point'; coordinates: [number, number] } | null;
  finish: { type: 'Point'; coordinates: [number, number] } | null;
  /** `null` — не в каталоге; документы до `0020_routes_catalog` поля не имеют — чтение `?? null`. */
  catalog: RouteCatalogDoc | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Детерминированный отказ пересчёта производных данных версии `version` (routes-03, RC-2). */
export interface RouteDerivedFailure {
  version: number;
  code: string;
  at: Date;
}

/**
 * Геометрия готового маршрута (`_id` = routeId): линии и число точек пишутся один раз при переходе в `ready`.
 * Производные данные (routes-03) — `profile`, `derivedVersion`, `derivedFailure` — пишет `markReady`, пересчитывает
 * только регламент `routes-maintenance` по росту `ROUTE_DERIVED_VERSION`; документы до `0021_routes_derived` полей не
 * имеют — чтение `?? null`. Есть `derivedVersion` ⇒ есть документ `route_exports` (одна транзакция, RC-1).
 */
export interface RouteGeometryDoc {
  _id: string;
  /** линия показа, ≤ 1000 точек [lon, lat] */
  line: { type: 'LineString'; coordinates: [number, number][] };
  /** линия сверки, ≤ 20 000 точек [lon, lat] (без индекса) */
  matchLine: [number, number][];
  sourcePointCount: number;
  /** профиль высоты `[distanceM, elevationM]`, ≤ 300 точек; `null` — в маршруте нет высот */
  profile?: [number, number][] | null;
  /** версия алгоритма производных; нет поля — не посчитаны */
  derivedVersion?: number;
  /** отказ разбора бэкфилла для версии (маршрут не берётся снова до роста версии) */
  derivedFailure?: RouteDerivedFailure;
}

/** Очищенный GPX маршрута (`_id` = routeId, ≤ ~1,2 МБ: ≤ 20 000 `trkpt`) — пишется вместе с `derivedVersion`. */
export interface RouteExportDoc {
  _id: string;
  gpx: Binary;
  sizeBytes: number;
  derivedVersion: number;
}

/**
 * Исходник GPX (`_id` = routeId, ≤ 5 МиБ) — в БД, не в `TrackFileStore`: уборка `tracks-maintenance` удаляет файлы
 * без документа `track_uploads`. Хранится для пересчёта линии сверки новой версией движка.
 */
export interface RouteSourceDoc {
  _id: string;
  bytes: Binary;
}

export interface RoutesCollections {
  routes: Collection<RouteDoc>;
  geometries: Collection<RouteGeometryDoc>;
  sources: Collection<RouteSourceDoc>;
  exports: Collection<RouteExportDoc>;
}

export function routesCollections(db: Db): RoutesCollections {
  return {
    routes: db.collection<RouteDoc>(ROUTES_COLLECTIONS.routes),
    geometries: db.collection<RouteGeometryDoc>(ROUTES_COLLECTIONS.geometries),
    sources: db.collection<RouteSourceDoc>(ROUTES_COLLECTIONS.sources),
    exports: db.collection<RouteExportDoc>(ROUTES_COLLECTIONS.exports),
  };
}
