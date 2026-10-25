import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';

/** Имя индекса публичного списка гонок сезона (`GET /v1/seasons/:id/races`, курсор `(windowEndsAt, _id)`). */
export const RACES_SEASON_PUBLIC_INDEX = 'races_season_public_idx';

/**
 * Гонки сезона публично (app-03, R3): `{ seasonId: 1, windowEndsAt: 1, _id: 1 }` — сортировка курсора без блокирующей
 * `SORT`. Старый `races_season_idx` остаётся (его снятие — отдельная задача с человеком). Expand-only, без
 * транзакции, идемпотентна.
 */
export const racesSeasonPublicIdx: MongoMigration = {
  id: '0009_races_season_public_idx',
  async up(db) {
    await db
      .collection(RACES_COLLECTIONS.races)
      .createIndex({ seasonId: 1, windowEndsAt: 1, _id: 1 }, { name: RACES_SEASON_PUBLIC_INDEX });
  },
};
