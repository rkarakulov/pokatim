import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import {
  PROFILE_REPORTS_COLLECTIONS,
  type ProfileReportDoc,
} from '../../modules/profile/profile-reports.collection';
import { PROFILE_COLLECTIONS, type ProfileDoc } from '../../modules/profile/profile.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Очередь жалоб панели по причине (profile-moderation-followups, RC-F1): multikey `openReasons` первым полем, порядок
 * — как у общей очереди; частичный по `openReportCount > 0` (запрос обязан содержать условие и `hint`).
 */
export const PROFILE_REPORT_REASONS_INDEXES = {
  profilesReportReasonQueue: {
    key: { openReasons: 1, lastReportAt: -1, _id: -1 },
    options: {
      name: 'profiles_report_reason_queue_idx',
      partialFilterExpression: { openReportCount: { $gt: 0 } },
    },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Причины открытых жалоб на документе профиля (profile-moderation-followups): индекс очереди по причине и бэкфилл
 * `profiles.openReasons` — причины открытых жалоб (`resolvedAt: null`) по цели; профили без открытых жалоб не
 * меняются (поля нет — `[]` при чтении). Expand-only, без транзакции, идемпотентна (`$set` того же множества). Окно
 * между бэкфиллом и новой версией API (RC-F11): жалоба, принятая старым API, не попадёт в `openReasons` до закрытия —
 * принято. После `0040_panel_totp`.
 */
export const profileReportReasons: MongoMigration = {
  id: '0042_profile_report_reasons',
  async up(db) {
    const profiles = db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
    for (const { key, options } of Object.values(PROFILE_REPORT_REASONS_INDEXES)) {
      await profiles.createIndex(key, options);
    }
    const open = db
      .collection<ProfileReportDoc>(PROFILE_REPORTS_COLLECTIONS.reports)
      .aggregate<{ _id: string; reasons: ProfileDoc['openReasons'] }>([
        { $match: { resolvedAt: null } },
        { $group: { _id: '$targetUserId', reasons: { $addToSet: '$reason' } } },
      ]);
    for await (const { _id, reasons } of open) {
      await profiles.updateOne(
        { _id, openReportCount: { $gt: 0 } },
        { $set: { openReasons: reasons ?? [] } },
      );
    }
  },
};
