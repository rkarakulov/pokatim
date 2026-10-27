import { Inject, Injectable } from '@nestjs/common';
import {
  MODERATION_ROUTE_REPORTS_MAX,
  ROUTE_REPORT_REASONS,
  type RouteReportReason,
} from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type RouteReportDoc,
  type RouteReportResolution,
  routeReportsCollections,
} from './route-reports.collection';

/** Индекс «одна жалоба на (маршрут, пользователь)» — дубль внутри транзакции жалобы (`isDuplicateKey`). */
export const ROUTE_REPORTS_UNIQUE_INDEX = 'route_reports_route_reporter_unique';

/**
 * Единственный писатель `route_reports` (routes-06, 8.1 RC-5): вставка жалобы, закрытие открытых (`resolvedAt: null`
 * → дата, один раз) и удаление всех жалоб маршрута вместе с ним (`deleteForRoute`, U6). Содержание не меняется
 * (сторож — `route-reports.repository.test.ts`). Значения фильтров — примитивы после zod.
 */
@Injectable()
export class RouteReportsRepository {
  private readonly reports: Collection<RouteReportDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.reports = routeReportsCollections(db).reports;
  }

  async insert(tx: DbSession, doc: RouteReportDoc): Promise<void> {
    await this.reports.insertOne(doc, { session: tx });
  }

  /** Жаловался ли пользователь на маршрут (по уникальному индексу). */
  async exists(routeId: string, reporterUserId: string): Promise<boolean> {
    const doc = await this.reports.findOne({ routeId, reporterUserId }, { projection: { _id: 1 } });
    return doc !== null;
  }

  /** Закрыть открытые жалобы маршрута (в транзакции действия модерации); число закрытых. */
  async closeOpen(
    tx: DbSession,
    routeId: string,
    resolution: RouteReportResolution,
    resolvedBy: string,
    now: Date,
  ): Promise<number> {
    const result = await this.reports.updateMany(
      { routeId, resolvedAt: null },
      { $set: { resolvedAt: now, resolution, resolvedBy } },
      { session: tx },
    );
    return result.modifiedCount;
  }

  /** Последние жалобы маршрута, новые сверху (`_id` — uuidv7), не больше 100. */
  latest(routeId: string, tx?: DbSession): Promise<RouteReportDoc[]> {
    return this.reports
      .find({ routeId }, { session: tx })
      .sort({ _id: -1 })
      .limit(MODERATION_ROUTE_REPORTS_MAX)
      .toArray();
  }

  /**
   * Самая частая открытая причина по каждому маршруту (одна агрегация на страницу очереди); ничья — порядок
   * `ROUTE_REPORT_REASONS`.
   */
  async topReasons(routeIds: readonly string[]): Promise<Map<string, RouteReportReason>> {
    const top = new Map<string, RouteReportReason>();
    if (routeIds.length === 0) return top;
    const groups = await this.reports
      .aggregate<{ _id: { routeId: string; reason: RouteReportReason }; count: number }>([
        { $match: { routeId: { $in: [...routeIds] }, resolvedAt: null } },
        { $group: { _id: { routeId: '$routeId', reason: '$reason' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const rank = (reason: RouteReportReason) => ROUTE_REPORT_REASONS.indexOf(reason);
    const best = new Map<string, { reason: RouteReportReason; count: number }>();
    for (const { _id, count } of groups) {
      const current = best.get(_id.routeId);
      if (
        !current ||
        count > current.count ||
        (count === current.count && rank(_id.reason) < rank(current.reason))
      ) {
        best.set(_id.routeId, { reason: _id.reason, count });
      }
    }
    for (const [routeId, { reason }] of best) top.set(routeId, reason);
    return top;
  }

  /**
   * Все жалобы маршрута — в транзакции его удаления (`RouteDeletion`, U6): единственное удаление жалоб. Жалобы
   * удалённого жалобщика на чужие маршруты не трогаются (как жалобы на райды).
   */
  async deleteForRoute(tx: DbSession, routeId: string): Promise<number> {
    const result = await this.reports.deleteMany({ routeId }, { session: tx });
    return result.deletedCount;
  }
}
