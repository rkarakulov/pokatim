import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PROFILE_REPORTS_COLLECTIONS } from '../../modules/profile/profile-reports.collection';
import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы модерации профилей (profile-moderation): одна открытая жалоба на (цель, жалобщик) — частичный уникальный по
 * `resolvedAt: null` (закрытие выводит жалобу из индекса — новая вставляется, S-1; запрос «есть открытая» обязан
 * содержать `resolvedAt: null`); жалобы карточки (100 новых), закрытие, агрегация причин и стирание — префикс
 * `targetUserId`; очередь панели — частичный по `profiles.openReportCount > 0` (запрос обязан содержать условие и
 * `hint`). Документы без полей жалоб в частичный индекс не попадают — бэкфилл не нужен.
 */
export const PROFILE_REPORTS_INDEXES = {
  reportsOpenUnique: {
    key: { targetUserId: 1, reporterUserId: 1 },
    options: {
      name: 'profile_reports_open_unique',
      unique: true,
      partialFilterExpression: { resolvedAt: { $eq: null } },
    },
  },
  reportsTarget: {
    key: { targetUserId: 1, _id: -1 },
    options: { name: 'profile_reports_target_idx' },
  },
  profilesReportQueue: {
    key: { lastReportAt: -1, _id: -1 },
    options: {
      name: 'profiles_report_queue_idx',
      partialFilterExpression: { openReportCount: { $gt: 0 } },
    },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Жалобы на профили (profile-moderation): коллекция `profile_reports` и индексы (жалобы, очередь по `profiles`).
 * Expand-only, без транзакции, без бэкфилла, идемпотентна. После `0033_rider_profile`.
 */
export const profileReports: MongoMigration = {
  id: '0034_profile_reports',
  async up(db) {
    await ensureCollection(db, PROFILE_REPORTS_COLLECTIONS.reports);
    const target = {
      reportsOpenUnique: PROFILE_REPORTS_COLLECTIONS.reports,
      reportsTarget: PROFILE_REPORTS_COLLECTIONS.reports,
      profilesReportQueue: PROFILE_COLLECTIONS.profiles,
    } as const;
    for (const [name, { key, options }] of Object.entries(PROFILE_REPORTS_INDEXES)) {
      await db.collection(target[name as keyof typeof target]).createIndex(key, options);
    }
  },
};
