import { Inject, Injectable } from '@nestjs/common';
import type { RouteFailureCode } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import { Binary, type Db, type Filter } from 'mongodb';

import type { DbSession } from '../../db';
import {
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

/**
 * Единственный писатель `routes`, `route_geometries`, `route_sources` (race-results-01). Правила (`pokatim-db.md`):
 * - переход статуса — только из `processing` (условие в фильтре): повтор задачи после `ready`/`failed` — no-op;
 * - готовый маршрут не меняется (геометрия пишется один раз, вместе с переходом в `ready`);
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
