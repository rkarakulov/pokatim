import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrackUpload } from '@pokatim/contracts';

import { TRACK_FILE_STORE, type TrackFileStore } from '../src/modules/tracks/track-file-store';
import { TrackProcessingProcessor } from '../src/modules/tracks/track-processing.processor';
import { TrackSourcesService } from '../src/modules/tracks/track-sources.service';
import { tracksCollections } from '../src/modules/tracks/tracks.collection';
import type { Harness } from './harness';

/** Фикстуры `packages/tracks` (синтетические, без персональных данных). */
const FIXTURES = fileURLToPath(
  new URL('../../../packages/tracks/src/__fixtures__', import.meta.url),
);

export const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

export const expectedFixtures = JSON.parse(
  readFileSync(join(FIXTURES, 'expected.json'), 'utf8'),
) as Record<string, { distanceM: number; elapsedSec?: number; points: number }>;

export const tracks = (h: Harness) => tracksCollections(h.db);

export interface UploadResult {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}

/** `POST /v1/tracks/uploads` сырыми байтами (`application/octet-stream` по умолчанию). */
export async function uploadTrack(
  h: Harness,
  auth: Record<string, string>,
  bytes: Buffer,
  options: { name?: string; contentType?: string; ip?: string } = {},
): Promise<UploadResult> {
  const query = options.name ? `?name=${encodeURIComponent(options.name)}` : '';
  const response = await h.app.inject({
    method: 'POST',
    url: `/v1/tracks/uploads${query}`,
    headers: {
      'content-type': options.contentType ?? 'application/octet-stream',
      ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
      ...auth,
    },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
  };
}

/** Загрузка из ответа `202`/`200` по контракту. */
export const parsedUpload = (result: UploadResult) => TrackUpload.parse(result.body);

/** Разбор загрузки задачей worker (как по событию outbox). */
export const processUpload = (h: Harness, uploadId: string) =>
  h.worker.get(TrackProcessingProcessor).processUpload(uploadId);

/** Хранилище исходников worker стенда (тесты других модулей: «исходник пропал»). */
export const trackFileStore = (h: Harness) => h.worker.get<TrackFileStore>(TRACK_FILE_STORE);

/** Приём исходника в обход HTTP (как запрос, прошедший гард до удаления аккаунта и закоммиченный позже). */
export const storeUpload = (h: Harness, userId: string, bytes: Buffer) =>
  h.worker.get(TrackSourcesService).store({
    userId,
    source: 'upload',
    via: null,
    sourceRef: null,
    format: 'gpx',
    fileName: null,
    bytes,
  });
