import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Индекс журнала согласий: история согласий пользователя, новые сверху (выдача доказательства, удаление). */
export const PROFILE_CONSENTS_INDEXES: Record<string, IndexDef[]> = {
  [PROFILE_COLLECTIONS.consentEvents]: [
    { key: { userId: 1, at: -1 }, options: { name: 'profile_consent_events_user_idx' } },
  ],
};

/** Журнал согласий профиля (profile-02): коллекция `profile_consent_events` и индекс. Expand-only, без транзакции. */
export const profileConsents: MongoMigration = {
  id: '0019_profile_consents',
  async up(db) {
    for (const [name, indexes] of Object.entries(PROFILE_CONSENTS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
