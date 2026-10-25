import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { ensureCollection } from './0002_identity';

/** Коллекция профилей райдера (онбординг, слайс 4): только создание, индексов сверх `_id` нет. Expand-only. */
export const profile: MongoMigration = {
  id: '0004_profile',
  up: (db) => ensureCollection(db, PROFILE_COLLECTIONS.profiles),
};
