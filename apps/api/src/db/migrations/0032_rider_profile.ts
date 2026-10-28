import { randomBytes } from 'node:crypto';

import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { RACES_COLLECTIONS } from '../../modules/races/races.collection';
import { RESULTS_COLLECTIONS } from '../../modules/results/results.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы профиля райдера (rider-profile): публичный id (уникален среди строк, `null` и отсутствие — вне индекса),
 * аватары пользователя (стирание), история гонок своего профиля (равенство `status` + keyset по дате гонки), строки
 * протокола райдера по всем ревизиям (статистика и публичная история).
 */
export const RIDER_PROFILE_INDEXES = {
  profilesPublicId: {
    key: { publicId: 1 },
    options: {
      name: 'profiles_public_id_unique',
      unique: true,
      partialFilterExpression: { publicId: { $type: 'string' } },
    },
  },
  avatarsUser: { key: { userId: 1 }, options: { name: 'profile_avatars_user_idx' } },
  entriesHistory: {
    key: { userId: 1, status: 1, raceWindowStartsAt: -1, _id: -1 },
    options: { name: 'race_entries_user_history_idx' },
  },
  protocolRowsUser: {
    key: { userId: 1, raceId: 1, revision: -1 },
    options: { name: 'race_protocol_rows_user_idx' },
  },
} as const satisfies Record<string, IndexDef>;

/**
 * Профиль райдера (rider-profile): коллекция `profile_avatars`; бэкфилл `profiles.publicId` у профилей с именем и
 * согласием (тот же генератор, что `randomToken` identity: 32 байта base64url) и `race_entries.raceWindowStartsAt`
 * (денормализация начала окна гонки — зафиксировано первой заявкой, V-12); затем индексы. Expand-only, без
 * транзакции, идемпотентна (условия — отсутствие поля). После `0031_rides_geo`.
 */
export const riderProfile: MongoMigration = {
  id: '0032_rider_profile',
  async up(db) {
    await ensureCollection(db, PROFILE_COLLECTIONS.avatars);

    const profiles = db.collection<{ _id: string; publicId?: string | null }>(
      PROFILE_COLLECTIONS.profiles,
    );
    const consenting = profiles.find(
      { publicName: { $type: 'string' }, showNameInResults: true, publicId: null },
      { projection: { _id: 1 } },
    );
    for await (const doc of consenting) {
      await profiles.updateOne(
        { _id: doc._id, publicId: null },
        { $set: { publicId: randomBytes(32).toString('base64url') } },
      );
    }

    const entries = db.collection<{ _id: string; raceId: string }>(RESULTS_COLLECTIONS.entries);
    const raceIds = await entries.distinct('raceId', { raceWindowStartsAt: { $exists: false } });
    if (raceIds.length > 0) {
      const races = await db
        .collection<{ _id: string; windowStartsAt: Date }>(RACES_COLLECTIONS.races)
        .find({ _id: { $in: raceIds } }, { projection: { windowStartsAt: 1 } })
        .toArray();
      for (const race of races) {
        await entries.updateMany(
          { raceId: race._id, raceWindowStartsAt: { $exists: false } },
          { $set: { raceWindowStartsAt: race.windowStartsAt } },
        );
      }
    }

    const target = {
      profilesPublicId: PROFILE_COLLECTIONS.profiles,
      avatarsUser: PROFILE_COLLECTIONS.avatars,
      entriesHistory: RESULTS_COLLECTIONS.entries,
      protocolRowsUser: RESULTS_COLLECTIONS.protocolRows,
    } as const;
    for (const [name, { key, options }] of Object.entries(RIDER_PROFILE_INDEXES)) {
      await db.collection(target[name as keyof typeof target]).createIndex(key, options);
    }
  },
};
