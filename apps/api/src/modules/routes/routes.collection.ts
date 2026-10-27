import type {
  CityCode,
  RouteFailureCode,
  RouteOrigin,
  RouteStatus,
  Surface,
} from '@pokatim/contracts';
import type { Binary, Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `routes` — эталонные маршруты коридора гонки (race-results-01, ADR-0012 п. 1) и личные маршруты
 * райдеров (routes-02). Создаёт миграция `0013_routes`; единственный писатель — `RoutesRepository`. Готовый маршрут
 * (`ready`) не меняет линию и длину (гонки хранят `routeId` и снимок длины); маршрут платформы не удаляется. Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным `null`.
 */
export const ROUTES_COLLECTIONS = {
  routes: 'routes',
  geometries: 'route_geometries',
  sources: 'route_sources',
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

/**
 * Маршрут. `platform` — маршрут команды (панель, каталог, коридоры); `rider` (routes-02) — личный маршрут райдера из
 * приложения: виден только автору, `catalog` всегда `null`, меняется только `title`, удаляется автором (транзакция
 * трёх коллекций). Чтение вне «моих» — только с `origin: 'platform'` в фильтре. Уникальны `(ownerUserId, origin,
 * sha256)` (`0021_routes_rider`).
 */
export interface RouteDoc {
  _id: string;
  origin: RouteOrigin;
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

/** Геометрия готового маршрута (`_id` = routeId): пишется один раз при переходе в `ready`. */
export interface RouteGeometryDoc {
  _id: string;
  /** линия показа, ≤ 1000 точек [lon, lat] */
  line: { type: 'LineString'; coordinates: [number, number][] };
  /** линия сверки, ≤ 20 000 точек [lon, lat] (без индекса) */
  matchLine: [number, number][];
  sourcePointCount: number;
}

/**
 * Исходник GPX/KML (`_id` = routeId, ≤ 5 МиБ) — в БД, не в `TrackFileStore`: уборка `tracks-maintenance` удаляет файлы
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
}

export function routesCollections(db: Db): RoutesCollections {
  return {
    routes: db.collection<RouteDoc>(ROUTES_COLLECTIONS.routes),
    geometries: db.collection<RouteGeometryDoc>(ROUTES_COLLECTIONS.geometries),
    sources: db.collection<RouteSourceDoc>(ROUTES_COLLECTIONS.sources),
  };
}
