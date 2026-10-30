import type {
  CityCode,
  RouteFailureCode,
  RouteOrigin,
  RouteRejectionReason,
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
  /** файлы маршрута для скачивания: очищенный GPX (routes-03), KML и TCX (routes-formats) */
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

/**
 * Публикация маршрута райдера в каталог (routes-06, A1): `pending` → `approved` | `rejected`; `approved` → `hidden` →
 * `approved`; автор отзывает и снимает (`withdrawn` — наружу `publication: null`). Каждый переход — одна условная
 * запись документа `routes` (`version` в фильтре); жалоба и «Отклонить жалобы» `version` не меняют, переименование автором
 * — меняет (модератор не вернёт в каталог название, которого не видел).
 */
export interface RoutePublicationDoc {
  status: 'pending' | 'approved' | 'rejected' | 'hidden' | 'withdrawn';
  city: CityCode;
  surfaces: Surface[];
  /** Согласие подписать маршрут публичным именем профиля (U3, 8.1 RC-2) — доказательство — сама заявка. */
  showAuthorName: boolean;
  submittedAt: Date;
  /** Успешных подач маршрута, ≤ 3 (U8); отзыв и снятие не сбрасывают. */
  submissionCount: number;
  decidedAt: Date | null;
  /** Первое одобрение этой заявки = `catalog.publishedAt` («Вернуть» — прежняя дата). */
  approvedAt: Date | null;
  rejection: { reason: RouteRejectionReason; comment: string | null } | null;
  hiddenAt: Date | null;
  /** Очередь «Жалобы»: переживают отзыв и новую подачу (8.1 RC-4). */
  openReportCount: number;
  lastReportAt: Date | null;
  /**
   * Ревизия жалоб: каждая жалоба — `$inc` той же записью (монотонна, в отличие от `lastReportAt`); «Отклонить жалобы»
   * сверяет увиденную в карточке (N7). Переживает новую подачу.
   */
  reportRevision: number;
  version: number;
}

/**
 * Маршрут. `platform` — маршрут команды (панель, каталог, коридоры); `rider` (routes-02) — личный маршрут райдера из
 * приложения: виден автору, а в каталоге — только одобренный модератором (routes-06: `catalog` заполнен тогда и
 * только тогда, когда `publication.status = 'approved'`); удаляется автором (транзакция коллекций маршрута и жалоб).
 * Порты гонок, панель «Маршруты» и кэши геометрии читают только `origin: 'platform'`. Уникальны `(ownerUserId, origin,
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
  /** routes-06: заявка в каталог маршрута райдера; документы без поля — `null` (не подавался, чтение `?? null`). */
  publication?: RoutePublicationDoc | null;
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
 * только регламент `routes-maintenance` по росту `ROUTE_DERIVED_VERSION`; документы до `0022_routes_derived` полей не
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

/**
 * Файлы маршрута для скачивания (`_id` = routeId) — пишутся вместе с `derivedVersion` геометрии одной транзакцией:
 * очищенный GPX (≤ ~1,2 МБ: ≤ 20 000 `trkpt`), KML (≤ ~0,6 МБ) и TCX (≤ ~4,6 МБ) из тех же точек (routes-formats).
 * У документов версии 1 `kml` и `tcx` нет (появятся после бэкфилла версии 2). `encoding: 'gzip'` (route-exports-gzip) —
 * все три поля сжаты gzip (новые записи всегда); нет поля — старый документ, UTF-8 как есть (пережмётся при росте
 * `derivedVersion`). `sizeBytes` — сумма **хранимых** байт файлов (диагностика объёма).
 */
export interface RouteExportDoc {
  _id: string;
  gpx: Binary;
  kml?: Binary;
  tcx?: Binary;
  encoding?: 'gzip';
  sizeBytes: number;
  derivedVersion: number;
}

/**
 * Исходник GPX/KML/KMZ/TCX (`_id` = routeId, ≤ 5 МиБ) — в БД, не в `TrackFileStore`: уборка `tracks-maintenance` удаляет файлы
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
