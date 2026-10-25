import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { TRACKS_COLLECTIONS } from '../../modules/tracks/tracks.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы треков (tracks-devices): уникальности дедупа загрузок (тот же файл, тот же объект провайдера), список
 * своих загрузок, уборка по статусу, кандидаты дубля по старту, `2dsphere` точки старта и линии.
 */
export const TRACKS_INDEXES: Record<string, IndexDef[]> = {
  [TRACKS_COLLECTIONS.uploads]: [
    {
      key: { userId: 1, sha256: 1 },
      options: { name: 'track_uploads_user_sha_unique', unique: true },
    },
    {
      key: { source: 1, sourceRef: 1 },
      options: {
        name: 'track_uploads_source_ref_unique',
        unique: true,
        partialFilterExpression: { sourceRef: { $type: 'string' } },
      },
    },
    { key: { userId: 1, _id: -1 }, options: { name: 'track_uploads_user_created_idx' } },
    { key: { status: 1, updatedAt: 1 }, options: { name: 'track_uploads_cleanup_idx' } },
  ],
  [TRACKS_COLLECTIONS.activities]: [
    { key: { userId: 1, startedAt: -1 }, options: { name: 'activities_user_started_idx' } },
    { key: { uploadId: 1 }, options: { name: 'activities_upload_idx' } },
    { key: { startPoint: '2dsphere' }, options: { name: 'activities_start_point_2dsphere' } },
  ],
  [TRACKS_COLLECTIONS.tracks]: [
    { key: { line: '2dsphere' }, options: { name: 'activity_tracks_line_2dsphere' } },
    { key: { userId: 1 }, options: { name: 'activity_tracks_user_idx' } },
  ],
  [TRACKS_COLLECTIONS.meta]: [],
};

/** Треки (tracks-devices): коллекции и индексы. Expand-only, без транзакции, идемпотентна. */
export const tracks: MongoMigration = {
  id: '0010_tracks',
  async up(db) {
    for (const [name, indexes] of Object.entries(TRACKS_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
