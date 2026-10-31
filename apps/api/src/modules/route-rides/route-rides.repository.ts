import { Inject, Injectable } from '@nestjs/common';
import { isDuplicateKey, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter } from 'mongodb';

import { type ChangedCursor, changedSort, changedWithin } from '../../changed-since';
import type { DbSession } from '../../db';
import {
  type RouteRideDoc,
  type RouteRidesCollections,
  routeRidesCollections,
} from './route-rides.collection';
import type { RiddenRoute, RouteRideFacts } from './route-rides.policy';

/** Индекс дедупликации заезда группы (`0032_route_rides`): параллельный POST — `isDuplicateKey`. */
export const ROUTE_RIDES_UNIQUE_INDEX = 'route_rides_user_route_activity_unique';

/** Итог проверки своей ревизией (`record`). */
export type RouteRideResult = Pick<
  RouteRideDoc,
  | 'status'
  | 'reasons'
  | 'failure'
  | 'segment'
  | 'touchedCorridor'
  | 'engineVersion'
  | 'trackMap'
  | 'checkedAt'
>;

/** Сброс итога при новой ревизии проверки. */
const cleared = (): RouteRideResult => ({
  status: 'queued',
  reasons: [],
  failure: null,
  segment: null,
  touchedCorridor: null,
  engineVersion: null,
  trackMap: null,
  checkedAt: null,
});

/**
 * Единственный писатель `route_rides` (route-rides-01). Каждое чтение — с `userId` в фильтре (свои заезды); итог
 * проверки пишет только своя ревизия (`checkRevision` и `checking` в фильтре); перепостановка — только `failed` или
 * зависший статус прежней ревизии.
 */
@Injectable()
export class RouteRidesRepository {
  private readonly c: RouteRidesCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = routeRidesCollections(db);
  }

  /** Свои заезды маршрута без `trackMap` (префикс уникального индекса). */
  listOwn(userId: string, routeId: string, session?: DbSession): Promise<RouteRideFacts[]> {
    return this.c.rides
      .find<RouteRideFacts>({ userId, routeId }, { session, projection: { trackMap: 0 } })
      .toArray();
  }

  async findOwn(userId: string, routeId: string, id: string): Promise<RouteRideDoc | undefined> {
    return (await this.c.rides.findOne({ _id: id, userId, routeId })) ?? undefined;
  }

  async findByActivity(
    userId: string,
    routeId: string,
    activityId: string,
  ): Promise<RouteRideDoc | undefined> {
    return (await this.c.rides.findOne({ userId, routeId, activityId })) ?? undefined;
  }

  async insert(session: DbSession, doc: RouteRideDoc): Promise<void> {
    await this.c.rides.insertOne(doc, { session });
  }

  /**
   * Готовый заезд автопроверки одной записью, без транзакции и outbox (route-rides-03, 8.1 AC-9). `false` — заезд
   * группы уже есть (дубль уникального индекса: ручной POST или повтор задачи успели раньше).
   */
  async insertChecked(doc: RouteRideDoc): Promise<boolean> {
    try {
      await this.c.rides.insertOne(doc);
      return true;
    } catch (error) {
      if (isDuplicateKey(error, ROUTE_RIDES_UNIQUE_INDEX)) return false;
      throw error;
    }
  }

  /**
   * Свои заезды по маршрутам (route-rides-03, план автопроверки): `$match { userId }` — префикс уникального индекса,
   * группировка по маршруту (id активностей, последняя дата заезда), маршруты с поздним последним заездом первыми, не
   * больше `limit`. Видимость и живость активностей — у вызывающего.
   */
  ridesByRoute(userId: string, limit: number): Promise<RiddenRoute[]> {
    return this.c.rides
      .aggregate<RiddenRoute>([
        { $match: { userId } },
        {
          $group: {
            _id: '$routeId',
            lastStartedAt: { $max: '$activity.startedAt' },
            activityIds: { $push: '$activityId' },
          },
        },
        { $sort: { lastStartedAt: -1, _id: 1 } },
        { $limit: limit },
        { $project: { _id: 0, routeId: '$_id', lastStartedAt: 1, activityIds: 1 } },
      ])
      .toArray();
  }

  /**
   * Новая ревизия проверки (повтор `failed` или зависшего): условие — прежняя ревизия и `failed` либо статус,
   * зависший раньше границы. `false` — заезд уже перепоставлен или итог записан (проиграл гонку).
   */
  async requeue(
    session: DbSession,
    id: string,
    checkRevision: number,
    stuck: { queuedBefore: Date; checkingBefore: Date },
    now: Date,
  ): Promise<boolean> {
    const result = await this.c.rides.updateOne(
      {
        _id: id,
        checkRevision,
        $or: [
          { status: 'failed' },
          { status: 'queued', updatedAt: { $lt: stuck.queuedBefore } },
          { status: 'checking', updatedAt: { $lt: stuck.checkingBefore } },
        ],
      },
      { $set: { ...cleared(), checkAttempts: 0, updatedAt: now }, $inc: { checkRevision: 1 } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /** Сироты маршрута (активность удалена, RC-1) — удаляются в транзакции нового заезда. */
  async deleteOrphans(
    session: DbSession,
    userId: string,
    routeId: string,
    ids: readonly string[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.c.rides.deleteMany(
      { _id: { $in: [...ids] }, userId, routeId },
      { session },
    );
    return result.deletedCount;
  }

  /** Захват своей ревизии: `queued|checking` → `checking`; иначе (итог, другая ревизия) — `null`. */
  claim(id: string, checkRevision: number, now: Date): Promise<RouteRideDoc | null> {
    return this.c.rides.findOneAndUpdate(
      { _id: id, checkRevision, status: { $in: ['queued', 'checking'] } },
      { $set: { status: 'checking', updatedAt: now }, $inc: { checkAttempts: 1 } },
      { returnDocument: 'after' },
    );
  }

  /** Итог своей ревизией (одна запись, без транзакции); `false` — перепоставлен или уже записан. */
  async record(
    id: string,
    checkRevision: number,
    result: RouteRideResult,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.c.rides.updateOne(
      { _id: id, checkRevision, status: 'checking' },
      { $set: { ...result, updatedAt: now } },
    );
    return updated.matchedCount === 1;
  }

  /**
   * Пройденные заезды райдера для достижений (порт `RIDER_ROUTE_RIDES`): `{ userId, status: 'passed' }` — префикс
   * уникального индекса; проекция — маршрут, активность и её старт. От ранних к поздним: при усечении по пределу
   * отбрасываются поздние, объект `route_first`/`routes_5` устойчив между сверками (ревью PR A, LOW-2).
   */
  passedOf(
    userId: string,
    limit: number,
  ): Promise<(Pick<RouteRideDoc, 'routeId' | 'activityId'> & { activity: { startedAt: Date } })[]> {
    return this.c.rides
      .find<Pick<RouteRideDoc, 'routeId' | 'activityId'> & { activity: { startedAt: Date } }>(
        { userId, status: 'passed' },
        { projection: { _id: 0, routeId: 1, activityId: 1, 'activity.startedAt': 1 } },
      )
      .sort({ 'activity.startedAt': 1, _id: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Заезды `passed` с записью в окне `(after, until]` по `(updatedAt, _id)` — серверная сверка достижений (порт
   * `RIDER_ROUTE_RIDES`; частичный индекс `route_rides_passed_updated_idx`, `0044_route_rides_passed_idx`). Окно — по
   * моменту записи итога (`record` ставит `updatedAt`), а не по `checkedAt`: тот берётся до ожидания семафора разбора и
   * может отставать от коммита больше `settleMs`. Прочие обновления `passed` дают лишь повтор (сверка идемпотентна).
   */
  passedWithin(
    after: ChangedCursor,
    until: Date,
    limit: number,
  ): Promise<{ _id: string; userId: string; updatedAt: Date }[]> {
    const window = changedWithin(after, until, 'updatedAt') as Filter<RouteRideDoc>;
    return this.c.rides
      .find<{ _id: string; userId: string; updatedAt: Date }>(
        { status: 'passed', ...window },
        { projection: { _id: 1, userId: 1, updatedAt: 1 } },
      )
      .sort(changedSort('updatedAt'))
      .limit(limit)
      .toArray();
  }

  /** Стирание заездов удалённого аккаунта (ADR-0015). */
  async deleteAllOf(userId: string): Promise<number> {
    return (await this.c.rides.deleteMany({ userId })).deletedCount;
  }
}
