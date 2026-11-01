import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { RACES_COLLECTIONS } from '../../modules/races/races.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Протоколы, опубликованные за окно (Главная «Свои», social-p7, RC-P7-16): `RacesRepository.protocolsPublishedSince`
 * — диапазон `protocolPublishedAt` ↓, `_id` ↓. Частичный: гонки без протокола в него не входят.
 */
export const RACES_PROTOCOL_PUBLISHED_INDEX = {
  key: { protocolPublishedAt: -1, _id: -1 },
  options: {
    name: 'races_protocol_published_idx',
    partialFilterExpression: { protocolPublishedAt: { $type: 'date' } },
  },
} as const satisfies IndexDef;

/** Индекс протоколов за окно (social-p7). Только expand: без транзакции, без бэкфилла, идемпотентна. */
export const socialHome: MongoMigration = {
  id: '0050_social_home',
  async up(db) {
    const { key, options } = RACES_PROTOCOL_PUBLISHED_INDEX;
    await db.collection(RACES_COLLECTIONS.races).createIndex(key, options);
  },
};
