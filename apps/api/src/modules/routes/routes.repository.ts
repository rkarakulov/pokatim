import { Inject, Injectable } from '@nestjs/common';
import {
  type CityCode,
  isCityCode,
  type RouteAuthorKind,
  type RouteDistanceBucket,
  type RouteExportFormat,
  type RouteFailureCode,
  type RouteOrigin,
  type RouteRejectionReason,
  type Surface,
} from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import { Binary, type Db, type Filter } from 'mongodb';

import {
  CHANGED_SORT,
  type ChangedCursor,
  changedAfter,
  type ChangedRow,
} from '../../changed-since';
import type { DbSession } from '../../db';
import { ROUTE_DISTANCE_RANGES_M } from './routes.policy';
import {
  type RouteCatalogDoc,
  type RouteDoc,
  type RouteGeometryDoc,
  type RoutePublicationDoc,
  type RoutesCollections,
  routesCollections,
} from './routes.collection';

/** Итог разбора маршрута для перехода `processing → ready`. */
export interface RouteReadyFields {
  distanceM: number;
  elevationGainM: number | null;
  isLoop: boolean;
  start: [number, number];
  finish: [number, number];
}

/** Фильтр каталога (значения — после zod `CatalogRouteQuery`). */
export interface CatalogFilter {
  cities?: readonly CityCode[];
  distance?: readonly RouteDistanceBucket[];
  surfaces?: readonly Surface[];
  /** routes-06: `team` — маршруты платформы, `rider` — одобренные маршруты райдеров. */
  authors?: readonly RouteAuthorKind[];
}

/** Позиция курсора каталога: момент публикации и `_id` последнего элемента страницы. */
export interface CatalogPosition {
  publishedAt: Date;
  id: string;
}

/**
 * Файлы экспорта маршрута одной версии (routes-03; KML и TCX — routes-formats): сжатые gzip байты UTF-8
 * (route-exports-gzip), посчитаны и сжаты worker'ом.
 */
export type RouteExportFiles = Record<RouteExportFormat, Uint8Array>;

/** Хранимый файл экспорта: байты как в БД и признак сжатия (`false` — старый несжатый документ). */
export interface StoredExportFile {
  bytes: Uint8Array;
  gzip: boolean;
}

/** Производные данные маршрута (routes-03) для карточки: `null` — не посчитаны или нет высот. */
export interface RouteDerivedState {
  profile: [number, number][] | null;
  derivedVersion: number | null;
}

/** Поля маршрута для райда (05c, порт `RideRoutes`): без линии, владельца и публикации. */
export type RideRouteFields = Pick<
  RouteDoc,
  '_id' | 'title' | 'distanceM' | 'elevationGainM' | 'start'
>;
const RIDE_ROUTE_PROJECTION = { title: 1, distanceM: 1, elevationGainM: 1, start: 1 } as const;

/** Поля маршрута заезда (route-rides-01, порт `RouteRideRoutes`): без линий, публикации и исходника. */
export type RideableRouteFields = Pick<
  RouteDoc,
  '_id' | 'title' | 'distanceM' | 'isLoop' | 'origin' | 'ownerUserId'
>;
const RIDEABLE_ROUTE_PROJECTION = {
  title: 1,
  distanceM: 1,
  isLoop: 1,
  origin: 1,
  ownerUserId: 1,
} as const;

/** Радиус Земли для `$centerSphere`, км — тот же, что у «Рядом» райдов (`rides.policy`, 05c). */
const EARTH_RADIUS_KM = 6378.1;

/** Маршрут команды платформы (routes-02, RC-2): условие каждого чтения панели, каталога и портов. */
const PLATFORM = { origin: 'platform' } as const;

/** Свой маршрут райдера (routes-02): единственное условие чтения и записи «моих». */
const ownRider = (ownerUserId: string) => ({ ownerUserId, origin: 'rider' }) as const;

/** Частичный индекс каталога (`0020_routes_catalog`). */
const CATALOG_INDEX = 'routes_catalog_idx';

/** Опубликован — условие частичного индекса `routes_catalog_idx` (обязательно в запросе каталога). */
const CATALOG_PUBLISHED = { 'catalog.publishedAt': { $type: 'date' } } as const;

/**
 * Публичный каталог (routes-06) — **единственное** условие списка, городов, карточки, карты и GPX: маршрут платформы
 * или одобренный маршрут райдера. Защита в глубину: маршрут райдера без `approved` не пройдёт, даже если `catalog`
 * записан по ошибке.
 */
const IN_CATALOG: Filter<RouteDoc> = {
  ...CATALOG_PUBLISHED,
  $or: [{ ...PLATFORM }, { origin: 'rider', 'publication.status': 'approved' }],
};

/** Опубликованный маршрут **команды** — порт `RouteCatalog.inCatalog` («Гонки на маршруте», U7: только платформа). */
const PLATFORM_CATALOG = { ...CATALOG_PUBLISHED, ...PLATFORM } as const;

/** Автор фильтра каталога → `origin`. */
const AUTHOR_ORIGIN: Record<RouteAuthorKind, RouteOrigin> = { team: 'platform', rider: 'rider' };

/** Состояния публикации, в которых маршрут райдера виден модератору (8.1 RC-10; `withdrawn` — нет). */
const MODERATION_VISIBLE = ['pending', 'approved', 'rejected', 'hidden'] as const;

/** Заявка в каталог (поля формы и согласие на подпись). */
export interface PublicationSubmission {
  city: CityCode;
  surfaces: Surface[];
  showAuthorName: boolean;
}

/** Очередь модерации маршрутов райдеров (routes-06, A5). */
export type PublicationQueue = 'pending' | 'reported' | 'hidden';

/** Позиция курсора очереди: ключ сортировки очереди и `_id` последнего элемента. */
export interface PublicationQueuePosition {
  at: Date;
  id: string;
}

/** Маршрут райдера с заявкой (модерация, жалобы). */
export type PublishedRiderRoute = RouteDoc & { publication: RoutePublicationDoc };

/**
 * Единственный писатель `routes`, `route_geometries`, `route_sources` (race-results-01). Правила (`pokatim-db.md`):
 * - переход статуса — только из `processing` (условие в фильтре): повтор задачи после `ready`/`failed` — no-op;
 * - готовый маршрут не меняет линию и длину (геометрия пишется один раз, вместе с переходом в `ready`);
 * - граница приватности (routes-02, RC-2) — здесь: чтения панели и портов гонок — с `origin: 'platform'` в фильтре;
 *   публичный каталог — только `IN_CATALOG` (routes-06: платформа или одобренный маршрут райдера); маршрут райдера
 *   автору — только методы `*Own` с `{ ownerUserId, origin: 'rider' }`, модератору — `findForModeration`/очереди;
 * - `catalog` маршрута райдера заполнен ⇔ `publication.status = 'approved'` (пишут одобрение и «Вернуть», снимают
 *   скрытие, отклонение, отзыв и снятие — одной записью с переходом);
 * - производные данные (`profile`, `derivedVersion`, `route_exports`, routes-03) пишут только `markReady` и
 *   `recordDerived` — обе с экспортом (GPX, KML, TCX — routes-formats) в одной транзакции (инвариант «есть
 *   `derivedVersion` ⇒ есть экспорт этой версии»: форматы карточки — по версии, `routeExportFormats`);
 * - значения фильтров — только примитивы после zod (id, статус).
 */
/** Очереди модерации маршрутов райдеров (routes-06): условие частичного индекса, ключ сортировки, индекс. */
const PUBLICATION_QUEUES = {
  pending: {
    filter: { 'publication.status': 'pending' },
    key: 'publication.submittedAt',
    dir: 1,
    index: 'routes_publication_pending_idx',
  },
  reported: {
    filter: { 'publication.openReportCount': { $gt: 0 }, 'publication.status': 'approved' },
    key: 'publication.lastReportAt',
    dir: -1,
    index: 'routes_publication_reports_idx',
  },
  hidden: {
    filter: { 'publication.status': 'hidden' },
    key: 'publication.hiddenAt',
    dir: -1,
    index: 'routes_publication_hidden_idx',
  },
} as const;

/** Фильтр очереди: условие её частичного индекса и только готовые маршруты райдеров. */
function publicationQueueFilter(queue: PublicationQueue): Filter<RouteDoc> {
  return { ...PUBLICATION_QUEUES[queue].filter, origin: 'rider', status: 'ready' };
}

@Injectable()
export class RoutesRepository {
  private readonly c: RoutesCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = routesCollections(db);
  }

  /** Новый маршрут и его исходник — в транзакции приёма (вместе с журналом и outbox). */
  async insertRoute(session: DbSession, route: RouteDoc, bytes: Uint8Array): Promise<void> {
    await this.c.routes.insertOne(route, { session });
    await this.c.sources.insertOne({ _id: route._id, bytes: new Binary(bytes) }, { session });
  }

  /** Дедуп приёма — в пределах происхождения (индекс `routes_owner_origin_sha_unique`). */
  async findByOwnerSha(
    origin: RouteOrigin,
    ownerUserId: string,
    sha256: string,
  ): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ ownerUserId, origin, sha256 })) ?? undefined;
  }

  /** Число маршрутов владельца в пределах происхождения (квота «моих», все статусы). */
  countOwned(origin: RouteOrigin, ownerUserId: string): Promise<number> {
    return this.c.routes.countDocuments({ ownerUserId, origin });
  }

  async findRoute(id: string, session?: DbSession): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ _id: id }, { session })) ?? undefined;
  }

  /**
   * Готовый маршрут платформы (`ready` терминален, маршрут платформы не удаляется: читать в транзакции гонки можно
   * без замка). Маршрут райдера — `undefined` (коридор, карта, сверка).
   */
  async findReady(id: string, session?: DbSession): Promise<RouteDoc | undefined> {
    return (
      (await this.c.routes.findOne({ _id: id, status: 'ready', ...PLATFORM }, { session })) ??
      undefined
    );
  }

  /**
   * Маршруты райдов (05c, порт `RideRoutes`): готовые и в публичном каталоге (`IN_CATALOG`) по id, ≤ 200 (вызывающий
   * дедуплицирует). Без кэша.
   */
  inCatalogByIds(ids: readonly string[]): Promise<RideRouteFields[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.routes
      .find<RideRouteFields>(
        { _id: { $in: [...ids] }, status: 'ready', ...IN_CATALOG },
        { projection: RIDE_ROUTE_PROJECTION },
      )
      .toArray();
  }

  /** Свои готовые маршруты райдера по id (05c, `ownRider`): чужие, платформы и не готовые — нет. */
  ownReadyByIds(ownerUserId: string, ids: readonly string[]): Promise<RideRouteFields[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.routes
      .find<RideRouteFields>(
        { _id: { $in: [...ids] }, status: 'ready', ...ownRider(ownerUserId) },
        { projection: RIDE_ROUTE_PROJECTION },
      )
      .toArray();
  }

  /** Свой готовый маршрут райдера (05c, прикрепление к райду). */
  async findOwnReady(ownerUserId: string, id: string): Promise<RideRouteFields | undefined> {
    return (
      (await this.c.routes.findOne<RideRouteFields>(
        { _id: id, status: 'ready', ...ownRider(ownerUserId) },
        { projection: RIDE_ROUTE_PROJECTION },
      )) ?? undefined
    );
  }

  /**
   * Маршрут заезда (route-rides-01, порт `RouteRideRoutes`): готовый и в публичном каталоге (`IN_CATALOG`) или свой
   * готовый маршрут райдера (`ownRider`). Без кэша, без линий.
   */
  async findRideable(userId: string, id: string): Promise<RideableRouteFields | undefined> {
    return (
      (await this.c.routes.findOne<RideableRouteFields>(
        { _id: id, status: 'ready', $or: [IN_CATALOG, ownRider(userId)] },
        { projection: RIDEABLE_ROUTE_PROJECTION },
      )) ?? undefined
    );
  }

  /**
   * Названия маршрутов заезда по id (achievements, порт `RouteRideRoutes.rideableTitles`): условие `findRideable`
   * (`ready`, `IN_CATALOG` или `ownRider`, длина есть) одним `find` с `$in` (≤ 500 id у вызывающего). Без кэша.
   */
  findRideableTitles(
    userId: string,
    ids: readonly string[],
  ): Promise<Pick<RouteDoc, '_id' | 'title'>[]> {
    return this.c.routes
      .find<Pick<RouteDoc, '_id' | 'title'>>(
        {
          _id: { $in: [...ids] },
          status: 'ready',
          distanceM: { $ne: null },
          $or: [IN_CATALOG, ownRider(userId)],
        },
        { projection: { title: 1 } },
      )
      .toArray();
  }

  /**
   * Свои готовые маршруты райдера (route-rides-03, порт `RouteRideRoutes.ownReadyIds`): `ownRider`, `ready`, длина
   * есть; `_id` убыв. (индекс `routes_owner_origin_idx`).
   */
  async ownReadyIds(ownerUserId: string, limit: number): Promise<string[]> {
    const docs = await this.c.routes
      .find<Pick<RouteDoc, '_id'>>(
        { ...ownRider(ownerUserId), status: 'ready', distanceM: { $ne: null } },
        { projection: { _id: 1 } },
      )
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  /**
   * Опубликованный маршрут **команды** (routes-01) — порт `RouteCatalog.inCatalog` («Гонки на маршруте»): маршрут
   * райдера — `undefined` (U7, 8.1 RC-1). Без кэша: каталог изменяем.
   */
  async findPublished(id: string): Promise<RouteDoc | undefined> {
    return (
      (await this.c.routes.findOne({ _id: id, status: 'ready', ...PLATFORM_CATALOG })) ?? undefined
    );
  }

  /**
   * Маршруты каталога, изменившиеся после курсора (`og.sync`), по `(updatedAt, _id)` — индекс `0037_og_sync_indexes`
   * (`status`, `updatedAt`, `_id`); условие каталога — `IN_CATALOG`.
   */
  async changedForOg(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    const docs = await this.c.routes
      .find(
        { $and: [{ status: 'ready', ...IN_CATALOG }, changedAfter(after) as Filter<RouteDoc>] },
        { projection: { _id: 1, updatedAt: 1 } },
      )
      .sort(CHANGED_SORT)
      .limit(limit)
      .toArray();
    return docs.map((doc) => ({ id: doc._id, updatedAt: doc.updatedAt }));
  }

  /**
   * Маршрут публичного каталога (routes-06) — карточка, карта, GPX: готовый и опубликованный маршрут команды или
   * одобренный маршрут райдера (`IN_CATALOG`). Иначе — `undefined` (один `404`). Без кэша.
   */
  async findInCatalog(id: string): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ _id: id, status: 'ready', ...IN_CATALOG })) ?? undefined;
  }

  /**
   * Страница каталога: новые публикации сверху (`publishedAt desc, _id desc`, индекс `routes_catalog_idx`). Внутри
   * фильтра — ИЛИ (покрытие — хотя бы одно из выбранных, корзины — `$or` диапазонов), между — И.
   */
  listCatalog(
    filter: CatalogFilter,
    after: CatalogPosition | null,
    limit: number,
  ): Promise<RouteDoc[]> {
    const and: Filter<RouteDoc>[] = [{ status: 'ready', ...IN_CATALOG }];
    if (filter.cities?.length) and.push({ 'catalog.city': { $in: [...filter.cities] } });
    if (filter.surfaces?.length) and.push({ 'catalog.surfaces': { $in: [...filter.surfaces] } });
    if (filter.authors?.length) {
      and.push({ origin: { $in: [...new Set(filter.authors.map((a) => AUTHOR_ORIGIN[a]))] } });
    }
    if (filter.distance?.length) {
      and.push({
        $or: filter.distance.map((bucket) => ({
          distanceM: { ...ROUTE_DISTANCE_RANGES_M[bucket] },
        })),
      });
    }
    if (after) {
      and.push({
        $or: [
          { 'catalog.publishedAt': { $lt: after.publishedAt } },
          { 'catalog.publishedAt': after.publishedAt, _id: { $lt: after.id } },
        ],
      });
    }
    return (
      this.c.routes
        .find({ $and: and })
        .sort({ 'catalog.publishedAt': -1, _id: -1 })
        // `origin` в фильтре делает кандидатом `routes_list_idx` (сортировка в памяти) — план фиксирован
        .hint(CATALOG_INDEX)
        .limit(limit)
        .toArray()
    );
  }

  /**
   * Главная «Свои» (social-p7, RC-P7-14): готовые маршруты райдеров `authorIds` в каталоге (`IN_CATALOG`), опубликованные
   * не раньше `since`, с согласием на подпись автора (`publication.showAuthorName`); `catalog.publishedAt ↓, _id ↓`,
   * ≤ `limit`; индекс `routes_catalog_idx` (план фиксирован, как у `listCatalog`).
   */
  recentRiderCatalog(
    authorIds: readonly string[],
    since: Date,
    limit: number,
  ): Promise<RouteDoc[]> {
    if (authorIds.length === 0) return Promise.resolve([]);
    return this.c.routes
      .find({
        $and: [
          { status: 'ready', ...IN_CATALOG },
          {
            origin: 'rider',
            ownerUserId: { $in: [...authorIds] },
            'publication.showAuthorName': true,
            'catalog.publishedAt': { $gte: since },
          },
        ],
      })
      .sort({ 'catalog.publishedAt': -1, _id: -1 })
      .hint(CATALOG_INDEX)
      .limit(limit)
      .toArray();
  }

  /** Коды городов старта маршрутов каталога (чипы фильтра), включая одобренные маршруты райдеров. */
  async catalogCities(): Promise<CityCode[]> {
    const cities: unknown[] = await this.c.routes.distinct('catalog.city', {
      status: 'ready',
      ...IN_CATALOG,
    });
    return cities.filter((city): city is CityCode => typeof city === 'string' && isCityCode(city));
  }

  /**
   * Публикация или правка каталожных полей готового маршрута платформы — в транзакции действия панели (чтение →
   * запись → журнал). `false` — маршрут не готов (условие в фильтре).
   */
  async setCatalog(
    session: DbSession,
    id: string,
    catalog: RouteCatalogDoc,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.routes.updateOne(
      { _id: id, status: 'ready', origin: 'platform' },
      { $set: { catalog, updatedAt: now } },
      { session },
    );
    return result.matchedCount === 1;
  }

  /** Снятие с публикации — в транзакции действия панели. `false` — маршрут не готов. */
  async clearCatalog(session: DbSession, id: string, now: Date): Promise<boolean> {
    const result = await this.c.routes.updateOne(
      { _id: id, status: 'ready', origin: 'platform' },
      { $set: { catalog: null, updatedAt: now } },
      { session },
    );
    return result.matchedCount === 1;
  }

  routesByIds(ids: readonly string[]): Promise<RouteDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.routes.find({ _id: { $in: [...ids] }, ...PLATFORM }).toArray();
  }

  /**
   * Список панели, новые сверху (`_id` — UUID v7): `readyOnly` — все готовые маршруты платформы; иначе — готовые +
   * свои необработанные (`processing`, `failed`) сотрудника `viewerUserId`. Только маршруты платформы.
   */
  listVisible(
    viewerUserId: string,
    readyOnly: boolean,
    beforeId: string | null,
    limit: number,
  ): Promise<RouteDoc[]> {
    const and: Filter<RouteDoc>[] = [
      readyOnly
        ? { origin: 'platform', status: 'ready' }
        : {
            $or: [
              { origin: 'platform', status: 'ready' },
              { origin: 'platform', ownerUserId: viewerUserId },
            ],
          },
    ];
    if (beforeId) and.push({ _id: { $lt: beforeId } });
    return this.c.routes.find({ $and: and }).sort({ _id: -1 }).limit(limit).toArray();
  }

  /** Свой маршрут райдера (routes-02): чужой, маршрут платформы и неизвестный — `undefined`. */
  async findOwn(ownerUserId: string, id: string): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ _id: id, ...ownRider(ownerUserId) })) ?? undefined;
  }

  /** Свои маршруты райдера, новые сверху (`_id` — UUID v7; индекс `routes_owner_origin_idx`). */
  listOwn(ownerUserId: string, beforeId: string | null, limit: number): Promise<RouteDoc[]> {
    return this.c.routes
      .find({ ...ownRider(ownerUserId), ...(beforeId ? { _id: { $lt: beforeId } } : {}) })
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Переименование своего маршрута; название заморожено в `pending` и `approved` (routes-06, A3) — условие в фильтре.
   * Есть заявка (`hidden`, `rejected`, `withdrawn`) — `publication.version + 1` той же записью: «Вернуть» по карточке со
   * старым названием получит конфликт. Pipeline — поле `publication` может быть `null`. `null` — не свой, нет или
   * заморожен (вызывающий перечитывает).
   */
  renameOwn(ownerUserId: string, id: string, title: string, now: Date): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        ...ownRider(ownerUserId),
        'publication.status': { $nin: ['pending', 'approved'] },
      },
      [
        {
          $set: {
            title: { $literal: title },
            updatedAt: { $literal: now },
            publication: {
              $cond: [
                { $eq: [{ $type: '$publication' }, 'object'] },
                {
                  $mergeObjects: [
                    '$publication',
                    { version: { $add: ['$publication.version', 1] } },
                  ],
                },
                '$publication',
              ],
            },
          },
        },
      ],
      { returnDocument: 'after' },
    );
  }

  // --- публикация маршрутов райдеров (routes-06): каждый переход — одна условная запись документа `routes` ---

  /**
   * Заявок райдера на рассмотрении (лимит U8, `routes_owner_origin_idx` + остаток). Счёт до записи — условие по другим
   * документам: **принятая гонка** (8.1 RC-7) — параллельные подачи превысят лимит не больше чем на их число, их режет
   * суточный лимит 10 (как квоты `rides`).
   */
  countPendingOwn(ownerUserId: string): Promise<number> {
    return this.c.routes.countDocuments({
      ...ownRider(ownerUserId),
      'publication.status': 'pending',
    });
  }

  /**
   * Подача своего готового маршрута: нет заявки / `withdrawn` / `rejected` → `pending`, подач < 3 — всё в фильтре.
   * Первая запись транзакции подачи (суточная квота списывается после неё, RC-8).
   * Pipeline-обновление (поле `publication` может быть `null`), значения — `$literal`; счётчики подач и версия — от
   * прежних, жалобы переживают новую подачу (8.1 RC-4). `null` — условие не выполнено (вызывающий перечитывает).
   */
  submitPublication(
    tx: DbSession,
    ownerUserId: string,
    id: string,
    submission: PublicationSubmission,
    maxSubmissions: number,
    now: Date,
  ): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        ...ownRider(ownerUserId),
        status: 'ready',
        $or: [{ publication: null }, { 'publication.status': { $in: ['withdrawn', 'rejected'] } }],
        'publication.submissionCount': { $not: { $gte: maxSubmissions } },
      },
      [
        {
          $set: {
            // `$mergeObjects` — новое значение целиком (поле могло быть `null`); прежние — только счётчики и версия
            publication: {
              $mergeObjects: [
                {
                  status: { $literal: 'pending' },
                  city: { $literal: submission.city },
                  surfaces: { $literal: submission.surfaces },
                  showAuthorName: { $literal: submission.showAuthorName },
                  submittedAt: { $literal: now },
                  submissionCount: {
                    $add: [{ $ifNull: ['$publication.submissionCount', 0] }, 1],
                  },
                  decidedAt: { $literal: null },
                  approvedAt: { $literal: null },
                  rejection: { $literal: null },
                  hiddenAt: { $literal: null },
                  openReportCount: { $ifNull: ['$publication.openReportCount', 0] },
                  lastReportAt: { $ifNull: ['$publication.lastReportAt', null] },
                  reportRevision: { $ifNull: ['$publication.reportRevision', 0] },
                  version: { $add: [{ $ifNull: ['$publication.version', -1] }, 1] },
                },
              ],
            },
            updatedAt: { $literal: now },
          },
        },
      ],
      { session: tx, returnDocument: 'after' },
    );
  }

  /**
   * Отзыв заявки (`pending`) или снятие с публикации (`approved`) автором → `withdrawn`, `catalog: null`, `version + 1`
   * (действие модератора по увиденной версии получит конфликт). Без транзакции и журнала (правило routes-02).
   */
  withdrawPublication(ownerUserId: string, id: string, now: Date): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        ...ownRider(ownerUserId),
        'publication.status': { $in: ['pending', 'approved'] },
      },
      {
        $set: { 'publication.status': 'withdrawn', catalog: null, updatedAt: now },
        $inc: { 'publication.version': 1 },
      },
      { returnDocument: 'after' },
    );
  }

  /** Поля уведомления о решении по заявке (`RouteNotices`): маршрут райдера — название, автор, заявка. */
  findForNotice(
    id: string,
  ): Promise<Pick<RouteDoc, '_id' | 'title' | 'ownerUserId' | 'publication'> | null> {
    return this.c.routes.findOne(
      { _id: id, origin: 'rider' },
      { projection: { title: 1, ownerUserId: 1, publication: 1 } },
    );
  }

  /**
   * Маршрут райдера для модерации: заявка в `pending | approved | rejected | hidden` (8.1 RC-10: не подававшийся и
   * отозванный — `undefined`). В транзакции действия — с её снимком.
   */
  async findForModeration(id: string, tx?: DbSession): Promise<PublishedRiderRoute | undefined> {
    const doc = await this.c.routes.findOne(
      {
        _id: id,
        origin: 'rider',
        status: 'ready',
        'publication.status': { $in: [...MODERATION_VISIBLE] },
      },
      { session: tx },
    );
    return doc?.publication ? (doc as PublishedRiderRoute) : undefined;
  }

  /** Условная запись перехода модерации по `version` (первая запись транзакции действия). */
  private moderate(
    tx: DbSession,
    id: string,
    from: RoutePublicationDoc['status'],
    version: number,
    extra: Filter<RouteDoc>,
    set: Record<string, unknown>,
    bump = true,
  ): Promise<PublishedRiderRoute | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        origin: 'rider',
        status: 'ready',
        'publication.status': from,
        'publication.version': version,
        ...extra,
      },
      { $set: set, ...(bump ? { $inc: { 'publication.version': 1 } } : {}) },
      { session: tx, returnDocument: 'after' },
    ) as Promise<PublishedRiderRoute | null>;
  }

  /** Одобрение: `pending` → `approved`, город и покрытие модератора; `catalog` — той же записью (`publishedAt = now`). */
  approvePublication(
    tx: DbSession,
    id: string,
    version: number,
    catalog: { city: CityCode; surfaces: Surface[] },
    now: Date,
  ): Promise<PublishedRiderRoute | null> {
    return this.moderate(
      tx,
      id,
      'pending',
      version,
      {},
      {
        'publication.status': 'approved',
        'publication.city': catalog.city,
        'publication.surfaces': catalog.surfaces,
        'publication.decidedAt': now,
        'publication.approvedAt': now,
        'publication.rejection': null,
        catalog: { city: catalog.city, surfaces: catalog.surfaces, publishedAt: now },
        updatedAt: now,
      },
    );
  }

  /** Отклонение: `pending` → `rejected` с причиной и комментарием автору. */
  rejectPublication(
    tx: DbSession,
    id: string,
    version: number,
    rejection: { reason: RouteRejectionReason; comment: string | null },
    now: Date,
  ): Promise<PublishedRiderRoute | null> {
    return this.moderate(
      tx,
      id,
      'pending',
      version,
      {},
      {
        'publication.status': 'rejected',
        'publication.decidedAt': now,
        'publication.rejection': rejection,
        catalog: null,
        updatedAt: now,
      },
    );
  }

  /** «Скрыть»: `approved` → `hidden`, `catalog: null`, открытые жалобы — 0 (их закрывает та же транзакция). */
  hidePublication(
    tx: DbSession,
    id: string,
    version: number,
    now: Date,
  ): Promise<PublishedRiderRoute | null> {
    return this.moderate(
      tx,
      id,
      'approved',
      version,
      {},
      {
        'publication.status': 'hidden',
        'publication.hiddenAt': now,
        'publication.openReportCount': 0,
        catalog: null,
        updatedAt: now,
      },
    );
  }

  /**
   * «Вернуть»: `hidden` → `approved`, `catalog` — город и покрытие заявки и прежняя дата одобрения (прочитаны в той же
   * транзакции; `version` в фильтре гарантирует, что они не менялись).
   */
  restorePublication(
    tx: DbSession,
    id: string,
    version: number,
    catalog: RouteCatalogDoc,
    now: Date,
  ): Promise<PublishedRiderRoute | null> {
    return this.moderate(
      tx,
      id,
      'hidden',
      version,
      {},
      {
        'publication.status': 'approved',
        'publication.hiddenAt': null,
        catalog,
        updatedAt: now,
      },
    );
  }

  /**
   * «Отклонить жалобы» по `version` и `reportRevision` карточки (новая жалоба — `null`): опубликованный с открытыми
   * жалобами → `openReportCount = 0`; `version` не меняется (как у райдов).
   */
  clearRouteReports(
    tx: DbSession,
    id: string,
    version: number,
    reportRevision: number,
  ): Promise<PublishedRiderRoute | null> {
    return this.moderate(
      tx,
      id,
      'approved',
      version,
      {
        'publication.openReportCount': { $gt: 0 },
        'publication.reportRevision': reportRevision,
      },
      { 'publication.openReportCount': 0 },
      false,
    );
  }

  /**
   * Жалоба — **первая** запись транзакции жалобы (конкурирующее «Скрыть» пишет тот же документ: write conflict):
   * опубликованный маршрут райдера, не свой → `$inc openReportCount` и `reportRevision` (маркер «Отклонить жалобы»),
   * `$max lastReportAt` (только порядок очереди). `null` — условие не выполнено.
   */
  recordRouteReport(
    tx: DbSession,
    id: string,
    reporterUserId: string,
    now: Date,
  ): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        origin: 'rider',
        status: 'ready',
        ownerUserId: { $ne: reporterUserId },
        'publication.status': 'approved',
        ...CATALOG_PUBLISHED,
      },
      {
        $inc: { 'publication.openReportCount': 1, 'publication.reportRevision': 1 },
        $max: { 'publication.lastReportAt': now },
      },
      { session: tx, returnDocument: 'after' },
    );
  }

  /**
   * Очереди модерации (A5) по частичным индексам `0029_routes_publication` (запрос содержит условие индекса; план
   * фиксирован `hint` — `origin` делает кандидатом `routes_list_idx`): «На проверке» — старые сверху; «Жалобы» — новые
   * жалобы сверху, только опубликованные (8.1 RC-4); «Скрытые» — недавно скрытые сверху.
   */
  listPublicationQueue(
    queue: PublicationQueue,
    after: PublicationQueuePosition | null,
    limit: number,
  ): Promise<PublishedRiderRoute[]> {
    const spec = PUBLICATION_QUEUES[queue];
    const and: Filter<RouteDoc>[] = [publicationQueueFilter(queue)];
    if (after) {
      const op = spec.dir === 1 ? '$gt' : '$lt';
      and.push({
        $or: [
          { [spec.key]: { [op]: after.at } },
          { [spec.key]: after.at, _id: { [op]: after.id } },
        ],
      });
    }
    return this.c.routes
      .find({ $and: and })
      .sort({ [spec.key]: spec.dir as 1 | -1, _id: spec.dir as 1 | -1 })
      .hint(spec.index)
      .limit(limit)
      .toArray() as Promise<PublishedRiderRoute[]>;
  }

  /** Размер очереди модерации (admin-overview, «Обзор» панели) — тот же фильтр и индекс, что у списка. */
  countPublicationQueue(queue: PublicationQueue): Promise<number> {
    return this.c.routes.countDocuments(publicationQueueFilter(queue), {
      hint: PUBLICATION_QUEUES[queue].index,
    });
  }

  /**
   * Удаление своего маршрута — в транзакции: маршрут (фильтр владельца и `rider`), геометрия, исходник и очищенный
   * GPX (`route_exports`, routes-03; бэкфилл пишет экспорт только при существующей геометрии). `false` — не
   * свой или нет (ничего не удалено). Запись worker'а того же маршрута конфликтует по документу `routes` — повтор.
   */
  async deleteOwn(session: DbSession, ownerUserId: string, id: string): Promise<boolean> {
    const deleted = await this.c.routes.deleteOne(
      { _id: id, ...ownRider(ownerUserId) },
      { session },
    );
    if (deleted.deletedCount !== 1) return false;
    await this.c.geometries.deleteOne({ _id: id }, { session });
    await this.c.sources.deleteOne({ _id: id }, { session });
    await this.c.exports.deleteOne({ _id: id }, { session });
    return true;
  }

  /** Id всех своих маршрутов райдера (`routes_owner_origin_idx`) — стирание удалённого аккаунта (`RouteErasure`). */
  async ownIds(ownerUserId: string): Promise<string[]> {
    const docs = await this.c.routes
      .find(ownRider(ownerUserId), { projection: { _id: 1 } })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  /**
   * Какие из id маршрутов есть в `routes` (любой статус) — висячие `routeId` райдов (05c, порт `RideRoutes`) и сироты
   * заездов по маршруту (route-rides-08, порт `RouteRideRoutes`).
   */
  async existingIds(ids: readonly string[]): Promise<string[]> {
    const docs = await this.c.routes
      .find({ _id: { $in: [...ids] } }, { projection: { _id: 1 } })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async geometry(id: string): Promise<RouteGeometryDoc | undefined> {
    return (await this.c.geometries.findOne({ _id: id })) ?? undefined;
  }

  /** Линии показа маршрутов по id одним `$in` с проекцией `line` (route-rides-03, ≤ 25 у вызывающего). */
  async displayLines(ids: readonly string[]): Promise<Map<string, [number, number][]>> {
    if (ids.length === 0) return new Map();
    const docs = await this.c.geometries
      .find({ _id: { $in: [...ids] } }, { projection: { line: 1 } })
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.line.coordinates]));
  }

  /** Только линия показа (проекция без `matchLine` ≤ 20 000 точек). */
  async displayLine(id: string): Promise<[number, number][] | undefined> {
    const doc = await this.c.geometries.findOne({ _id: id }, { projection: { line: 1 } });
    return doc?.line.coordinates;
  }

  /**
   * Линия показа и профиль высоты страницы маршрута панели (routes-05, RC-6): одним запросом с проекцией — без
   * `matchLine` (≤ 20 000 точек).
   */
  async panelGeometry(
    id: string,
  ): Promise<{ line: [number, number][]; profile: [number, number][] | null } | undefined> {
    const doc = await this.c.geometries.findOne(
      { _id: id },
      { projection: { line: 1, profile: 1 } },
    );
    return doc ? { line: doc.line.coordinates, profile: doc.profile ?? null } : undefined;
  }

  /** Захват задачи разбора: только `processing` (терминальный статус — `null`, повтор — no-op). */
  claim(id: string, now: Date): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      { _id: id, status: 'processing' },
      { $set: { updatedAt: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
  }

  async sourceBytes(id: string): Promise<Uint8Array | undefined> {
    const doc = await this.c.sources.findOne({ _id: id });
    return doc ? new Uint8Array(doc.bytes.buffer) : undefined;
  }

  /**
   * Переход `processing → ready` с геометрией, производными данными и очищенным GPX — в транзакции. `false` — маршрут
   * уже не `processing` (повтор задачи): транзакция откатывается вызывающим, геометрия и экспорт не остаются.
   */
  /**
   * Id готовых маршрутов в каталоге (`IN_CATALOG`), чей старт в круге (`$geoWithin $centerSphere`, индекс
   * `routes_start_2dsphere`), по `_id`, не больше `limit` (05c, порт `RideRoutes.publicStartsWithin`). Без кэша.
   */
  async inCatalogStartsWithin(
    center: readonly [number, number],
    radiusKm: number,
    limit: number,
  ): Promise<string[]> {
    const docs = await this.c.routes
      .find<{ _id: string }>(
        {
          status: 'ready',
          ...IN_CATALOG,
          start: {
            $geoWithin: { $centerSphere: [[center[0], center[1]], radiusKm / EARTH_RADIUS_KM] },
          },
        },
        { projection: { _id: 1 } },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async markReady(
    session: DbSession,
    id: string,
    fields: RouteReadyFields,
    geometry: Omit<RouteGeometryDoc, '_id' | 'derivedFailure'> & { derivedVersion: number },
    files: RouteExportFiles,
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.routes.updateOne(
      { _id: id, status: 'processing' },
      {
        $set: {
          status: 'ready',
          failure: null,
          distanceM: fields.distanceM,
          elevationGainM: fields.elevationGainM,
          isLoop: fields.isLoop,
          start: { type: 'Point', coordinates: fields.start },
          finish: { type: 'Point', coordinates: fields.finish },
          updatedAt: now,
        },
      },
      { session },
    );
    if (result.modifiedCount !== 1) return false;
    await this.c.geometries.replaceOne({ _id: id }, geometry, { session, upsert: true });
    await this.writeExport(session, id, files, geometry.derivedVersion);
    return true;
  }

  /**
   * Экспорт целиком (`replaceOne`): сжатые gzip GPX, KML и TCX одной версии, `encoding: 'gzip'`; `sizeBytes` — сумма
   * хранимых (сжатых) байт.
   */
  private async writeExport(
    session: DbSession,
    id: string,
    files: RouteExportFiles,
    derivedVersion: number,
  ): Promise<void> {
    await this.c.exports.replaceOne(
      { _id: id },
      {
        gpx: new Binary(files.gpx),
        kml: new Binary(files.kml),
        tcx: new Binary(files.tcx),
        encoding: 'gzip',
        sizeBytes: files.gpx.byteLength + files.kml.byteLength + files.tcx.byteLength,
        derivedVersion,
      },
      { session, upsert: true },
    );
  }

  /**
   * Готовые маршруты без производных данных версии `version` (бэкфилл `routes-maintenance`, RC-3): нет поля или
   * меньше версии (оба плеча — индекс `route_geometries_derived_idx`), без отказа этой версии; только `_id`.
   */
  async pendingDerived(version: number, limit: number): Promise<string[]> {
    const docs = await this.c.geometries
      .find(
        {
          $or: [{ derivedVersion: { $exists: false } }, { derivedVersion: { $lt: version } }],
          'derivedFailure.version': { $ne: version },
        },
        { projection: { _id: 1 } },
      )
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  /**
   * Производные данные версии `version` и экспорт — в транзакции бэкфилла. `false` — уже посчитаны этой или более
   * новой версией (условие в фильтре): экспорт не пишется.
   */
  async recordDerived(
    session: DbSession,
    id: string,
    version: number,
    profile: [number, number][] | null,
    files: RouteExportFiles,
  ): Promise<boolean> {
    const result = await this.c.geometries.updateOne(
      {
        _id: id,
        $or: [{ derivedVersion: { $exists: false } }, { derivedVersion: { $lt: version } }],
      },
      { $set: { profile, derivedVersion: version }, $unset: { derivedFailure: '' } },
      { session },
    );
    if (result.matchedCount === 0) return false;
    await this.writeExport(session, id, files, version);
    return true;
  }

  /** Детерминированный отказ пересчёта версии `version`: маршрут не берётся снова до роста версии (RC-2). */
  async markDerivedFailed(id: string, version: number, code: string, now: Date): Promise<void> {
    await this.c.geometries.updateOne(
      { _id: id },
      { $set: { derivedFailure: { version, code, at: now } } },
    );
  }

  /** Профиль и версия производных — проекцией, без линий (карточка каталога, RC-4: без кэша). */
  async derivedOf(id: string): Promise<RouteDerivedState | undefined> {
    const doc = await this.c.geometries.findOne(
      { _id: id },
      { projection: { profile: 1, derivedVersion: 1 } },
    );
    if (!doc) return undefined;
    return { profile: doc.profile ?? null, derivedVersion: doc.derivedVersion ?? null };
  }

  /**
   * Файл экспорта маршрута в формате `format` — проекцией этого поля и `encoding`; байты как хранятся (`gzip` —
   * сжаты, route-exports-gzip). Нет документа или поля (экспорт версии 1 без KML/TCX) — `undefined`.
   */
  async exportFile(id: string, format: RouteExportFormat): Promise<StoredExportFile | undefined> {
    const doc = await this.c.exports.findOne(
      { _id: id },
      { projection: { [format]: 1, encoding: 1 } },
    );
    const file = doc?.[format];
    return file ? { bytes: new Uint8Array(file.buffer), gzip: doc.encoding === 'gzip' } : undefined;
  }

  /**
   * Тот же файл загружен снова, а маршрут не готов: отказ (`failed`) или обработка, зависшая дольше
   * `ROUTE_POLICY.stuckAfterMs` (`updatedAt < staleBefore`), — снова `processing` (попытки с нуля). `null` — маршрут
   * уже готов или обрабатывается (повтор не нужен).
   */
  requeue(session: DbSession, id: string, staleBefore: Date, now: Date): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      {
        _id: id,
        $or: [{ status: 'failed' }, { status: 'processing', updatedAt: { $lt: staleBefore } }],
      },
      { $set: { status: 'processing', failure: null, attempts: 0, updatedAt: now } },
      { session, returnDocument: 'after' },
    );
  }

  /** Финальный отказ разбора; только из `processing`. */
  async markFailed(id: string, failure: RouteFailureCode, now: Date): Promise<boolean> {
    const result = await this.c.routes.updateOne(
      { _id: id, status: 'processing' },
      { $set: { status: 'failed', failure, updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }
}
