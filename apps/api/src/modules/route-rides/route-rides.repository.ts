import { Inject, Injectable } from '@nestjs/common';
import { isDuplicateKey, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter } from 'mongodb';

import { type ChangedCursor, changedSort, changedWithin } from '../../changed-since';
import type { DbSession } from '../../db';
import {
  type RouteRideDoc,
  type RouteRideAutoPlanDoc,
  type RouteRideResult,
  type RouteRidesCollections,
  routeRidesCollections,
} from './route-rides.collection';
import type { TopRide } from './route-ride-leaderboard';
import type { GroupRide, RiddenRoute, RouteRideFacts } from './route-rides.policy';

/** Индекс дедупликации заезда группы (`0032_route_rides`): параллельный POST — `isDuplicateKey`. */
export const ROUTE_RIDES_UNIQUE_INDEX = 'route_rides_user_route_activity_unique';
/** Индекс таблицы «Другие» (`0049_route_rides_leaderboard_idx`) — `hint` агрегата `leaderboardTop`. */
export const ROUTE_RIDES_LEADERBOARD_INDEX = 'route_rides_leaderboard_idx';

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
  sections: null,
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
   * Свои заезды по маршрутам (route-rides-03, план автопроверки): `$match { userId }` — префикс уникального индекса —
   * **без заездов группы события** (`exceptActivityIds`: автозаезды не сдвигают окно скана, ревью pass 2), группировка
   * по маршруту (активность и дата заезда), маршруты с поздним последним заездом первыми (порядок скана; итоговый — по
   * живым заездам в `autoPlan`), не больше `limit`. Видимость и живость активностей — у вызывающего.
   */
  ridesByRoute(
    userId: string,
    limit: number,
    exceptActivityIds: readonly string[],
  ): Promise<RiddenRoute[]> {
    return this.c.rides
      .aggregate<RiddenRoute>([
        { $match: { userId, activityId: { $nin: [...exceptActivityIds] } } },
        {
          $group: {
            _id: '$routeId',
            lastStartedAt: { $max: '$activity.startedAt' },
            rides: { $push: { activityId: '$activityId', startedAt: '$activity.startedAt' } },
          },
        },
        { $sort: { lastStartedAt: -1, _id: 1 } },
        { $limit: limit },
        { $project: { _id: 0, routeId: '$_id', rides: 1 } },
      ])
      .toArray();
  }

  /**
   * Таблица «Другие» (route-rides-04, RC-4): пройденные заезды маршрута **всех** райдеров (индекс
   * `route_rides_leaderboard_idx`), по райдеру — до `topPerRider` лучших в порядке `compareRides`; райдеры — по лучшему
   * из них, не больше `scanRiders`. Согласие, живость активностей и видимость маршрута — у вызывающего; наружу из
   * модуля `userId` не выходит.
   */
  leaderboardTop(
    routeId: string,
    scanRiders: number,
    topPerRider: number,
  ): Promise<{ userId: string; top: TopRide[] }[]> {
    return this.c.rides
      .aggregate<{ userId: string; top: TopRide[] }>(
        [
          { $match: { routeId, status: 'passed' } },
          {
            $group: {
              _id: '$userId',
              top: {
                $topN: {
                  n: topPerRider,
                  sortBy: { 'segment.elapsedSec': 1, 'activity.startedAt': 1, _id: 1 },
                  output: {
                    id: '$_id',
                    activityId: '$activityId',
                    elapsedSec: '$segment.elapsedSec',
                    startedAt: '$activity.startedAt',
                  },
                },
              },
            },
          },
          { $set: { best: { $first: '$top' } } },
          { $sort: { 'best.elapsedSec': 1, 'best.startedAt': 1, 'best.id': 1 } },
          { $limit: scanRiders },
          { $project: { _id: 0, userId: '$_id', top: 1 } },
        ],
        { hint: ROUTE_RIDES_LEADERBOARD_INDEX },
      )
      .toArray();
  }

  /** Заезды группы события по всем маршрутам (route-rides-03): маршрут и происхождение; активностей ≤ размера группы. */
  groupRides(userId: string, activityIds: readonly string[]): Promise<GroupRide[]> {
    return this.c.rides
      .find<GroupRide>(
        { userId, activityId: { $in: [...activityIds] } },
        { projection: { _id: 0, routeId: 1, origin: 1 } },
      )
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

  /**
   * Сироты маршрута (активность удалена, RC-1), которых не убрало событие `tracks.activity-removed` (POST вставил заезд
   * после обработки события), — удаляются в транзакции нового заезда.
   */
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

  /**
   * Заезды удалённой активности по всем маршрутам (`tracks.activity-removed`); `userId` — префикс уникального индекса.
   * Идемпотентно: повтор удаляет 0.
   */
  async deleteOfActivity(userId: string, activityId: string): Promise<number> {
    return (await this.c.rides.deleteMany({ userId, activityId })).deletedCount;
  }

  /** План автопроверки события (route-rides-03); нет — `null`. */
  async autoPlanOf(eventId: string): Promise<string[] | null> {
    const doc = await this.c.autoPlans.findOne({ _id: eventId }, { projection: { routeIds: 1 } });
    return doc?.routeIds ?? null;
  }

  /** Фиксация плана события: первая запись побеждает (дубль `_id_` — план, сохранённый раньше). */
  async saveAutoPlan(doc: RouteRideAutoPlanDoc): Promise<string[]> {
    try {
      await this.c.autoPlans.insertOne(doc);
      return doc.routeIds;
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      const saved = await this.autoPlanOf(doc._id);
      if (!saved) throw error;
      return saved;
    }
  }

  /** Стирание заездов и планов автопроверки удалённого аккаунта (ADR-0015); число — стёртых заездов. */
  async deleteAllOf(userId: string): Promise<number> {
    await this.c.autoPlans.deleteMany({ userId });
    return (await this.c.rides.deleteMany({ userId })).deletedCount;
  }
}
