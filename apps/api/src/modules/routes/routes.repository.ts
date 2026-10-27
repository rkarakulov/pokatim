import { Inject, Injectable } from '@nestjs/common';
import {
  type CityCode,
  isCityCode,
  type RouteDistanceBucket,
  type RouteFailureCode,
  type RouteOrigin,
  type Surface,
} from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import { Binary, type Db, type Filter } from 'mongodb';

import type { DbSession } from '../../db';
import { ROUTE_DISTANCE_RANGES_M } from './routes.policy';
import {
  type RouteCatalogDoc,
  type RouteDoc,
  type RouteGeometryDoc,
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
}

/** Позиция курсора каталога: момент публикации и `_id` последнего элемента страницы. */
export interface CatalogPosition {
  publishedAt: Date;
  id: string;
}

/** Маршрут команды платформы (routes-02, RC-2): условие каждого чтения панели, каталога и портов. */
const PLATFORM = { origin: 'platform' } as const;

/** Свой маршрут райдера (routes-02): единственное условие чтения и записи «моих». */
const ownRider = (ownerUserId: string) => ({ ownerUserId, origin: 'rider' }) as const;

/**
 * Опубликован в каталоге — условие частичного индекса `routes_catalog_idx` (обязательно в запросе каталога); только
 * маршрут платформы (защита в глубину: у маршрута райдера `catalog` всегда `null`).
 */
const IN_CATALOG = { 'catalog.publishedAt': { $type: 'date' }, ...PLATFORM } as const;

/**
 * Единственный писатель `routes`, `route_geometries`, `route_sources` (race-results-01). Правила (`pokatim-db.md`):
 * - переход статуса — только из `processing` (условие в фильтре): повтор задачи после `ready`/`failed` — no-op;
 * - готовый маршрут не меняет линию и длину (геометрия пишется один раз, вместе с переходом в `ready`);
 * - граница приватности (routes-02, RC-2) — здесь: чтения панели, каталога и портов — с `origin: 'platform'` в
 *   фильтре; маршрут райдера — только методы `*Own` с `{ ownerUserId, origin: 'rider' }`;
 * - значения фильтров — только примитивы после zod (id, статус).
 */
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
   * Маршрут каталога (routes-01) — единственная точка публичной видимости: готовый и опубликованный. Неизвестный,
   * не готовый, не опубликованный и снятый — `undefined` (один `404`). Без кэша: каталог изменяем.
   */
  async findPublished(id: string): Promise<RouteDoc | undefined> {
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
    return this.c.routes
      .find({ $and: and })
      .sort({ 'catalog.publishedAt': -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Коды городов старта опубликованных маршрутов (чипы фильтра). */
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

  /** Переименование своего маршрута (в любом статусе); `null` — не свой или нет. */
  renameOwn(ownerUserId: string, id: string, title: string, now: Date): Promise<RouteDoc | null> {
    return this.c.routes.findOneAndUpdate(
      { _id: id, ...ownRider(ownerUserId) },
      { $set: { title, updatedAt: now } },
      { returnDocument: 'after' },
    );
  }

  /**
   * Удаление своего маршрута — в транзакции: маршрут (фильтр владельца и `rider`), геометрия, исходник. `false` — не
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
    return true;
  }

  async geometry(id: string): Promise<RouteGeometryDoc | undefined> {
    return (await this.c.geometries.findOne({ _id: id })) ?? undefined;
  }

  /** Только линия показа (проекция без `matchLine` ≤ 20 000 точек). */
  async displayLine(id: string): Promise<[number, number][] | undefined> {
    const doc = await this.c.geometries.findOne({ _id: id }, { projection: { line: 1 } });
    return doc?.line.coordinates;
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
   * Переход `processing → ready` с геометрией — в транзакции. `false` — маршрут уже не `processing` (повтор задачи):
   * транзакция откатывается вызывающим, геометрия не остаётся.
   */
  async markReady(
    session: DbSession,
    id: string,
    fields: RouteReadyFields,
    geometry: Omit<RouteGeometryDoc, '_id'>,
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
    return true;
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
