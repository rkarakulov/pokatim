import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';

/**
 * Последний видимый вердикт попытки (notifications RC-2): попытки с вердиктом `counted`/`rejected` без поля получают
 * `lastVisibleVerdict = status` — иначе первая же перепроверка старых гонок разослала бы «засчитан» повторно. Прочие
 * статусы поля не получают (чтение `?? null`). Скрытые авто-попытки тоже получают статус: их перепроверка с тем же
 * исходом события не даёт, а смена на видимый противоположный — даёт. Expand-only, без транзакции, идемпотентна.
 */
export const attemptLastVerdict: MongoMigration = {
  id: '0026_attempt_last_verdict',
  async up(db) {
    await db
      .collection(RESULTS_COLLECTIONS.attempts)
      .updateMany(
        { status: { $in: ['counted', 'rejected'] }, lastVisibleVerdict: { $exists: false } },
        [{ $set: { lastVisibleVerdict: '$status' } }],
      );
  },
};
