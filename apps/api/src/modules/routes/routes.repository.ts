import { Inject, Injectable } from '@nestjs/common';
import {
  type CityCode,
  isCityCode,
  type RouteDistanceBucket,
  type RouteFailureCode,
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

/** Производные данные маршрута (routes-03) для карточки: `null` — не посчитаны или нет высот. */
export interface RouteDerivedState {
  profile: [number, number][] | null;
  derivedVersion: number | null;
}

/** Опубликован в каталоге — условие частичного индекса `routes_catalog_idx` (обязательно в запросе каталога). */
const IN_CATALOG = { 'catalog.publishedAt': { $type: 'date' } } as const;

/**
 * Единственный писатель `routes`, `route_geometries`, `route_sources` (race-results-01). Правила (`pokatim-db.md`):
 * - переход статуса — только из `processing` (условие в фильтре): повтор задачи после `ready`/`failed` — no-op;
 * - готовый маршрут не меняется (линии и длина пишутся один раз, вместе с переходом в `ready`);
 * - производные данные (`profile`, `derivedVersion`, `route_exports`, routes-03) пишут только `markReady` и
 *   `recordDerived` — обе с экспортом GPX в одной транзакции (инвариант «есть `derivedVersion` ⇒ есть экспорт»);
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

  async findByOwnerSha(ownerUserId: string, sha256: string): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ ownerUserId, sha256 })) ?? undefined;
  }

  async findRoute(id: string, session?: DbSession): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Готовый маршрут (`ready` терминален: читать в транзакции гонки можно без замка). */
  async findReady(id: string, session?: DbSession): Promise<RouteDoc | undefined> {
    return (await this.c.routes.findOne({ _id: id, status: 'ready' }, { session })) ?? undefined;
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
    return this.c.routes.find({ _id: { $in: [...ids] } }).toArray();
  }

  /**
   * Список панели, новые сверху (`_id` — UUID v7): `readyOnly` — все готовые маршруты платформы; иначе — готовые +
   * свои необработанные (`processing`, `failed`) сотрудника `viewerUserId`.
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
        : { $or: [{ origin: 'platform', status: 'ready' }, { ownerUserId: viewerUserId }] },
    ];
    if (beforeId) and.push({ _id: { $lt: beforeId } });
    return this.c.routes.find({ $and: and }).sort({ _id: -1 }).limit(limit).toArray();
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
   * Переход `processing → ready` с геометрией, производными данными и очищенным GPX — в транзакции. `false` — маршрут
   * уже не `processing` (повтор задачи): транзакция откатывается вызывающим, геометрия и экспорт не остаются.
   */
  async markReady(
    session: DbSession,
    id: string,
    fields: RouteReadyFields,
    geometry: Omit<RouteGeometryDoc, '_id' | 'derivedFailure'> & { derivedVersion: number },
    gpx: Uint8Array,
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
    await this.writeExport(session, id, gpx, geometry.derivedVersion);
    return true;
  }

  private async writeExport(
    session: DbSession,
    id: string,
    gpx: Uint8Array,
    derivedVersion: number,
  ): Promise<void> {
    await this.c.exports.replaceOne(
      { _id: id },
      { gpx: new Binary(gpx), sizeBytes: gpx.byteLength, derivedVersion },
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
    gpx: Uint8Array,
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
    await this.writeExport(session, id, gpx, version);
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

  /** Очищенный GPX маршрута; нет экспорта — `undefined`. */
  async exportGpx(id: string): Promise<Uint8Array | undefined> {
    const doc = await this.c.exports.findOne({ _id: id }, { projection: { gpx: 1 } });
    return doc ? new Uint8Array(doc.gpx.buffer) : undefined;
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
