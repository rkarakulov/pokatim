import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { TRACKS_COLLECTIONS } from '../../modules/tracks/tracks.collection';
import { ensureCollection } from './0002_identity';

/** Индекс маркеров источника по пользователю — будущее удаление аккаунта (`pokatim-db.md`). */
export const TRACK_SOURCE_REFS_USER_INDEX = 'track_source_refs_user_idx';

/**
 * Маркеры объектов источника `track_source_refs` (ревью tracks-devices, HIGH-4): удалённый пользователем заезд
 * агрегатора не воскресает при повторе импорта. Expand-only, без транзакции, идемпотентна.
 */
export const trackSourceRefs: MongoMigration = {
  id: '0012_track_source_refs',
  async up(db) {
    await ensureCollection(db, TRACKS_COLLECTIONS.sourceRefs);
    await db
      .collection(TRACKS_COLLECTIONS.sourceRefs)
      .createIndex({ userId: 1 }, { name: TRACK_SOURCE_REFS_USER_INDEX });
  },
};
