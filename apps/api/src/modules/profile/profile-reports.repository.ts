import { Inject, Injectable } from '@nestjs/common';
import {
  MODERATION_PROFILE_REPORTS_MAX,
  PROFILE_REPORT_REASONS,
  type ProfileReportReason,
} from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type ProfileReportDoc,
  type ProfileReportResolution,
  profileReportsCollections,
} from './profile-reports.collection';

/** Индекс «одна открытая жалоба на (цель, пользователь)» — дубль внутри транзакции жалобы (`isDuplicateKey`). */
export const PROFILE_REPORTS_OPEN_UNIQUE_INDEX = 'profile_reports_open_unique';

/**
 * Единственный писатель `profile_reports` (profile-moderation): вставка жалобы, закрытие открытых (`resolvedAt: null`
 * → дата, один раз) и удаление всех жалоб на удалённый аккаунт (`deleteForTarget`). Содержание не меняется (сторож —
 * `profile-reports.repository.test.ts`). Значения фильтров — `userId` из access/пути после zod.
 */
@Injectable()
export class ProfileReportsRepository {
  private readonly reports: Collection<ProfileReportDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.reports = profileReportsCollections(db).reports;
  }

  async insert(tx: DbSession, doc: ProfileReportDoc): Promise<void> {
    await this.reports.insertOne(doc, { session: tx });
  }

  /** Есть ли открытая жалоба пользователя на профиль (частичный уникальный индекс: `resolvedAt: null` обязателен). */
  async openExists(targetUserId: string, reporterUserId: string): Promise<boolean> {
    const doc = await this.reports.findOne(
      { targetUserId, reporterUserId, resolvedAt: null },
      { projection: { _id: 1 } },
    );
    return doc !== null;
  }

  /** Закрыть открытые жалобы на профиль (в транзакции действия модерации); число закрытых. */
  async closeOpen(
    tx: DbSession,
    targetUserId: string,
    resolution: ProfileReportResolution,
    resolvedBy: string,
    now: Date,
  ): Promise<number> {
    const result = await this.reports.updateMany(
      { targetUserId, resolvedAt: null },
      { $set: { resolvedAt: now, resolution, resolvedBy } },
      { session: tx },
    );
    return result.modifiedCount;
  }

  /**
   * Авторы открытых жалоб на профиль без дублей (profile-moderation-d11): читается в транзакции действия **до**
   * `closeOpen` — та же транзакция уже записала профиль (новая жалоба конфликтует), набор совпадает с закрытыми.
   */
  async openReporters(tx: DbSession, targetUserId: string): Promise<string[]> {
    const docs = await this.reports
      .find(
        { targetUserId, resolvedAt: null },
        { projection: { _id: 0, reporterUserId: 1 }, session: tx },
      )
      .toArray();
    return [...new Set(docs.map((doc) => doc.reporterUserId))];
  }

  /** Последние жалобы на профиль, новые сверху (`_id` — uuidv7), не больше 100. */
  latest(targetUserId: string): Promise<ProfileReportDoc[]> {
    return this.reports
      .find({ targetUserId })
      .sort({ _id: -1 })
      .limit(MODERATION_PROFILE_REPORTS_MAX)
      .toArray();
  }

  /**
   * Самая частая открытая причина по каждому профилю (одна агрегация на страницу очереди); ничья — порядок
   * `PROFILE_REPORT_REASONS`.
   */
  async topReasons(userIds: readonly string[]): Promise<Map<string, ProfileReportReason>> {
    const top = new Map<string, ProfileReportReason>();
    if (userIds.length === 0) return top;
    const groups = await this.reports
      .aggregate<{ _id: { userId: string; reason: ProfileReportReason }; count: number }>([
        { $match: { targetUserId: { $in: [...userIds] }, resolvedAt: null } },
        { $group: { _id: { userId: '$targetUserId', reason: '$reason' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const rank = (reason: ProfileReportReason) => PROFILE_REPORT_REASONS.indexOf(reason);
    const best = new Map<string, { reason: ProfileReportReason; count: number }>();
    for (const { _id, count } of groups) {
      const current = best.get(_id.userId);
      if (
        !current ||
        count > current.count ||
        (count === current.count && rank(_id.reason) < rank(current.reason))
      ) {
        best.set(_id.userId, { reason: _id.reason, count });
      }
    }
    for (const [userId, { reason }] of best) top.set(userId, reason);
    return top;
  }

  /**
   * Стирание удалённого аккаунта (`ProfileErasure`, ADR-0015): все жалобы **на** пользователя (комментарии могут
   * содержать его ПДн). Жалобы, поданные им на других, не трогаются (псевдонимный `reporterUserId`).
   */
  async deleteForTarget(targetUserId: string): Promise<number> {
    return (await this.reports.deleteMany({ targetUserId })).deletedCount;
  }
}
