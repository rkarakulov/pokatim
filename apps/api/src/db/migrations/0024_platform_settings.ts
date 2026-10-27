import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { APPEARANCE_COLLECTIONS } from '../../modules/appearance/appearance.collection';
import { ensureCollection } from './0002_identity';

/**
 * Настройки платформы (app-themes): коллекция `platform_settings` без индексов сверх `_id` и без seed — нет документа
 * `appearance` значит «Классика», `version: 0`. Expand-only, без транзакции, идемпотентна.
 */
export const platformSettings: MongoMigration = {
  id: '0024_platform_settings',
  up: (db) => ensureCollection(db, APPEARANCE_COLLECTIONS.settings),
};
