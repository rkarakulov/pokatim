import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RIDE_REPORTS_COLLECTIONS } from '../../modules/rides/ride-reports.collection';
import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы модерации кофе-райдов (05b, 8.1 D7): одна жалоба на (райд, пользователь) — и `reported` зрителя/ленты;
 * жалобы карточки (100 новых по `_id`), закрытие и агрегация причин — префикс `rideId`. Очереди — по `rides`:
 * частичные индексы (запрос обязан содержать условие частичного фильтра).
 */
export const RIDE_REPORTS_INDEXES: Record<string, IndexDef[]> = {
  [RIDE_REPORTS_COLLECTIONS.reports]: [
    {
      key: { rideId: 1, reporterUserId: 1 },
      options: { name: 'ride_reports_ride_reporter_unique', unique: true },
    },
    { key: { rideId: 1, _id: -1 }, options: { name: 'ride_reports_ride_idx' } },
  ],
  [RIDES_COLLECTIONS.rides]: [
    {
      key: { lastReportAt: -1, _id: -1 },
      options: {
        name: 'rides_report_queue_idx',
        partialFilterExpression: { openReportCount: { $gt: 0 } },
      },
    },
    {
      key: { hiddenAt: -1, _id: -1 },
      options: { name: 'rides_hidden_queue_idx', partialFilterExpression: { status: 'hidden' } },
    },
  ],
};

/** Поля модерации райда и их значения у документов до 05b. */
const RIDE_MODERATION_DEFAULTS = {
  openReportCount: 0,
  lastReportAt: null,
  hiddenAt: null,
  hiddenFromStatus: null,
} as const;

/**
 * Жалобы и модерация кофе-райдов (05b): коллекция `ride_reports`, индексы жалоб и очередей, бэкфилл полей
 * модерации у райдов без них (по полю, `$exists: false` — идемпотентно; чтение всё равно терпит отсутствие).
 * Expand-only, без транзакции. Номер `0017`: `0016` занимает слайс «Протокол» (8.1 A1).
 */
export const rideReports: MongoMigration = {
  id: '0017_ride_reports',
  async up(db) {
    for (const [name, indexes] of Object.entries(RIDE_REPORTS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
    const rides = db.collection(RIDES_COLLECTIONS.rides);
    for (const [field, value] of Object.entries(RIDE_MODERATION_DEFAULTS)) {
      await rides.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
    }
  },
};
