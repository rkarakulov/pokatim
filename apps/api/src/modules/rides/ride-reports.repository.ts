import { Inject, Injectable } from '@nestjs/common';
import {
  MODERATION_RIDE_REPORTS_MAX,
  RIDE_REPORT_REASONS,
  type RideReportReason,
} from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type RideReportDoc,
  type RideReportResolution,
  rideReportsCollections,
} from './ride-reports.collection';

/** Индекс «одна жалоба на (райд, пользователь)» — дубль внутри транзакции жалобы (`isDuplicateKey`). */
export const RIDE_REPORTS_UNIQUE_INDEX = 'ride_reports_ride_reporter_unique';

/**
 * Единственный писатель `ride_reports` (8.1 A7): только вставка жалобы и закрытие открытых (`resolvedAt: null` →
 * дата, один раз); содержание не меняется, удалений нет (сторож — `ride-reports.repository.test.ts`). Значения
 * фильтров — примитивы после zod.
 */
@Injectable()
export class RideReportsRepository {
  private readonly reports: Collection<RideReportDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.reports = rideReportsCollections(db).reports;
  }

  async insert(tx: DbSession, doc: RideReportDoc): Promise<void> {
    await this.reports.insertOne(doc, { session: tx });
  }

  /** Жаловался ли пользователь на райд (по уникальному индексу). */
  async exists(rideId: string, reporterUserId: string): Promise<boolean> {
    const doc = await this.reports.findOne({ rideId, reporterUserId }, { projection: { _id: 1 } });
    return doc !== null;
  }

  /** Райды страницы, на которые пользователь жаловался (один запрос на страницу ленты). */
  async reportedRideIds(reporterUserId: string, rideIds: readonly string[]): Promise<Set<string>> {
    if (rideIds.length === 0) return new Set();
    const docs = await this.reports
      .find({ reporterUserId, rideId: { $in: [...rideIds] } }, { projection: { rideId: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc.rideId));
  }

  /** Закрыть открытые жалобы райда (в транзакции действия модерации); число закрытых. */
  async closeOpen(
    tx: DbSession,
    rideId: string,
    resolution: RideReportResolution,
    resolvedBy: string,
    now: Date,
  ): Promise<number> {
    const result = await this.reports.updateMany(
      { rideId, resolvedAt: null },
      { $set: { resolvedAt: now, resolution, resolvedBy } },
      { session: tx },
    );
    return result.modifiedCount;
  }

  /** Последние жалобы райда, новые сверху (`_id` — uuidv7), не больше 100. */
  latest(rideId: string, tx?: DbSession): Promise<RideReportDoc[]> {
    return this.reports
      .find({ rideId }, { session: tx })
      .sort({ _id: -1 })
      .limit(MODERATION_RIDE_REPORTS_MAX)
      .toArray();
  }

  /**
   * Самая частая открытая причина по каждому райду (одна агрегация на страницу очереди); ничья — порядок
   * `RIDE_REPORT_REASONS`.
   */
  async topReasons(rideIds: readonly string[]): Promise<Map<string, RideReportReason>> {
    const top = new Map<string, RideReportReason>();
    if (rideIds.length === 0) return top;
    const groups = await this.reports
      .aggregate<{ _id: { rideId: string; reason: RideReportReason }; count: number }>([
        { $match: { rideId: { $in: [...rideIds] }, resolvedAt: null } },
        { $group: { _id: { rideId: '$rideId', reason: '$reason' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const best = new Map<string, { reason: RideReportReason; count: number }>();
    const rank = (reason: RideReportReason) => RIDE_REPORT_REASONS.indexOf(reason);
    for (const { _id, count } of groups) {
      const current = best.get(_id.rideId);
      if (
        !current ||
        count > current.count ||
        (count === current.count && rank(_id.reason) < rank(current.reason))
      ) {
        best.set(_id.rideId, { reason: _id.reason, count });
      }
    }
    for (const [rideId, { reason }] of best) top.set(rideId, reason);
    return top;
  }
}
