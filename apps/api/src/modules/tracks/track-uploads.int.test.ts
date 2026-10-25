import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { TrackUploadPage } from '@pokatim/contracts';
import { TrackStreamV1 } from '@pokatim/tracks';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import {
  bearer,
  call,
  gate,
  outboxEvents,
  signUpSession,
  untilBlocked,
  userIdByEmail,
} from '../../../test/identity';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import {
  expectedFixtures,
  fixture,
  parsedUpload,
  processUpload,
  tracks,
  uploadTrack,
} from '../../../test/tracks';
import { TrackProcessingProcessor } from './track-processing.processor';
import { newStorageKey, TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import { TRACK_INGEST, type TrackIngest, TrackSourceDeletedError } from './track-ingest.port';
import { TracksMaintenanceProcessor } from './tracks-maintenance.processor';
import { TracksRepository } from './tracks.repository';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

let auth: Record<string, string>;
let userId: string;
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
  const session = await signUpSession(h);
  auth = bearer(session.accessToken);
  userId = await userIdByEmail(h);
});

const storedFiles = async (): Promise<string[]> => {
  const files: string[] = [];
  for await (const file of h.worker.get<TrackFileStore>(TRACK_FILE_STORE).list())
    files.push(file.key);
  return files;
};

const within1pct = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.01);

/** Поток агрегатора того же заезда, что `garmin-connect.gpx` (фикстура `ow-stream.json`). */
const owStream = (overrides: Partial<TrackStreamV1> = {}): TrackStreamV1 => ({
  ...TrackStreamV1.parse(JSON.parse(fixture('ow-stream.json').toString('utf8'))),
  ...overrides,
});

describe('AC1: загрузка FIT/GPX → queued → ready', () => {
  it('FIT Garmin Edge: 202 queued, outbox, разбор → активность, линия ≤ 1000 в 2dsphere, файл байт-в-байт', async () => {
    const bytes = fixture('garmin-edge-ride.fit');
    const response = await uploadTrack(h, auth, bytes, { name: 'Утро.fit' });
    expect(response.status).toBe(202);
    expect(response.headers['cache-control']).toBe('no-store');
    const upload = parsedUpload(response);
    expect(upload).toMatchObject({
      source: 'upload',
      format: 'fit',
      fileName: 'Утро.fit',
      status: 'queued',
      failure: null,
      activity: null,
    });
    const events = await outboxEvents(h);
    expect(events.map((event) => [event.type, event.payload])).toContainEqual([
      'tracks.upload-received',
      { uploadId: upload.id },
    ]);

    expect(await processUpload(h, upload.id)).toBe('ready');

    const doc = await tracks(h).uploads.findOne({ _id: upload.id });
    expect(doc).toMatchObject({ status: 'ready', format: 'fit', userId, attempts: 1 });
    const stored = await h.worker.get<TrackFileStore>(TRACK_FILE_STORE).get(doc?.storageKey ?? '');
    expect(Buffer.from(stored).equals(bytes)).toBe(true);

    const activity = await tracks(h).activities.findOne({ uploadId: upload.id });
    const expected = expectedFixtures['garmin-edge-ride.fit'];
    expect(activity).toMatchObject({ sport: 'cycling', source: 'upload', duplicateOf: null });
    within1pct(activity?.distanceM ?? 0, expected?.distanceM ?? 1);
    expect(activity?.elapsedSec).toBe(expected?.elapsedSec);
    expect(activity).toMatchObject({ hasPower: true, hasHeartRate: true });

    const line = await tracks(h).tracks.findOne({ _id: activity?._id });
    expect(line?.line.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(line?.line.coordinates.length).toBeLessThanOrEqual(1000);
    // геоиндекс: линия находится запросом по прямоугольнику вокруг центра Минска
    const nearMinsk = await tracks(h)
      .tracks.find({
        line: {
          $geoIntersects: {
            $geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [27.4, 53.8],
                  [27.7, 53.8],
                  [27.7, 54.0],
                  [27.4, 54.0],
                  [27.4, 53.8],
                ],
              ],
            },
          },
        },
      })
      .toArray();
    expect(nearMinsk.map((doc) => doc._id)).toEqual([activity?._id]);

    const view = await call(h, 'GET', `/v1/tracks/uploads/${upload.id}`, undefined, auth);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      status: 'ready',
      activity: { id: activity?._id, sport: 'cycling', elapsedSec: expected?.elapsedSec },
    });
  });

  it('GPX (экспорт Garmin Connect) и FIT Wahoo — ready, дистанция ±1 % от эталона', async () => {
    const gpx = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
    expect(gpx.format).toBe('gpx');
    expect(await processUpload(h, gpx.id)).toBe('ready');
    const gpxActivity = await tracks(h).activities.findOne({ uploadId: gpx.id });
    within1pct(gpxActivity?.distanceM ?? 0, expectedFixtures.gpx?.distanceM ?? 1);

    const wahoo = parsedUpload(await uploadTrack(h, auth, fixture('wahoo-elemnt-ride.fit')));
    expect(await processUpload(h, wahoo.id)).toBe('ready');
    const wahooActivity = await tracks(h).activities.findOne({ uploadId: wahoo.id });
    within1pct(
      wahooActivity?.distanceM ?? 0,
      expectedFixtures['wahoo-elemnt-ride.fit']?.distanceM ?? 1,
    );
    expect(wahooActivity).toMatchObject({ hasPower: false, hasHeartRate: true });
  });

  it('AC9: ручная загрузка бега принимается — ready, sport other', async () => {
    const run = parsedUpload(await uploadTrack(h, auth, fixture('watch-run.fit')));
    expect(await processUpload(h, run.id)).toBe('ready');
    expect(await tracks(h).activities.findOne({ uploadId: run.id })).toMatchObject({
      sport: 'other',
    });
  });
});

describe('AC2: отказы загрузки', () => {
  it('PNG с именем .fit — 415; 0 байт — 400; 17 МиБ — 413; JSON вместо octet-stream — 415', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const notFit = await uploadTrack(h, auth, png, { name: 'ride.fit' });
    expect(notFit.status).toBe(415);
    expect(notFit.body).toMatchObject({ code: 'TRACK_FORMAT_UNSUPPORTED' });

    const empty = await uploadTrack(h, auth, Buffer.alloc(0));
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ code: 'VALIDATION_FAILED' });

    const large = await uploadTrack(h, auth, Buffer.alloc(17 * 1024 * 1024, 0x20));
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ code: 'TRACK_TOO_LARGE' });

    const json = await uploadTrack(h, auth, Buffer.from('{"a":1}'), {
      contentType: 'application/json',
    });
    expect(json.status).toBe(415);

    expect(await tracks(h).uploads.countDocuments()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('GPX с <!DOCTYPE>/<!ENTITY> (XXE, «миллиард смехов») — 415 до хранилища и разбора (§8.2)', async () => {
    for (const name of ['xxe.gpx', 'billion-laughs.gpx']) {
      const refused = await uploadTrack(h, auth, fixture(name));
      expect(refused.status).toBe(415);
      expect(refused.body).toMatchObject({ code: 'TRACK_FORMAT_UNSUPPORTED' });
    }
    expect(await storedFiles()).toEqual([]);
  });

  it('имя с путём или управляющими символами — 400', async () => {
    const bad = await uploadTrack(h, auth, fixture('komoot.gpx'), { name: '../../etc/passwd' });
    expect(bad.status).toBe(400);
    expect(await tracks(h).uploads.countDocuments()).toBe(0);
  });

  it.each([
    ['corrupted-crc.fit', 'unreadable'],
    ['truncated.fit', 'unreadable'],
    ['empty-trk.gpx', 'no_track'],
    ['no-time.gpx', 'no_timestamps'],
    ['indoor-trainer.fit', 'no_track'],
  ])('%s → failed: %s', async (name, failure) => {
    const upload = parsedUpload(await uploadTrack(h, auth, fixture(name)));
    expect(upload.status).toBe('queued');
    expect(await processUpload(h, upload.id)).toBe('failed');
    const view = await call(h, 'GET', `/v1/tracks/uploads/${upload.id}`, undefined, auth);
    expect(view.body).toMatchObject({ status: 'failed', failure, activity: null });
    expect(await tracks(h).activities.countDocuments()).toBe(0);
  });

  it('разбор дольше лимита — failed: timeout (поток прерван)', async () => {
    const processor = h.worker.get(TrackProcessingProcessor);
    const limits = processor.parseLimits;
    processor.parseLimits = { ...limits, timeoutMs: 1 };
    try {
      const upload = parsedUpload(await uploadTrack(h, auth, fixture('garmin-edge-ride.fit')));
      expect(await processUpload(h, upload.id)).toBe('failed');
      expect(await tracks(h).uploads.findOne({ _id: upload.id })).toMatchObject({
        failure: 'timeout',
      });
    } finally {
      processor.parseLimits = limits;
    }
  });

  it('без входа — 401 (тело не читается); чужая загрузка — 404 на чтение и удаление', async () => {
    const anonymous = await uploadTrack(h, {}, fixture('komoot.gpx'));
    expect(anonymous.status).toBe(401);
    expect(await tracks(h).uploads.countDocuments()).toBe(0);

    const own = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    const other = bearer((await signUpSession(h, 'other@example.com')).accessToken);
    expect((await call(h, 'GET', `/v1/tracks/uploads/${own.id}`, undefined, other)).status).toBe(
      404,
    );
    expect((await call(h, 'POST', `/v1/tracks/uploads/${own.id}/delete`, {}, other)).status).toBe(
      404,
    );
    expect(await call(h, 'GET', '/v1/tracks/uploads', undefined, other)).toMatchObject({
      status: 200,
      body: { items: [], nextCursor: null },
    });
    expect((await call(h, 'GET', '/v1/tracks/uploads/not-a-uuid', undefined, auth)).status).toBe(
      400,
    );
  });

  it('инъекция оператора в query списка — 400', async () => {
    const injected = await call(h, 'GET', '/v1/tracks/uploads?cursor[$ne]=x', undefined, auth);
    expect(injected.status).toBe(400);
  });

  it('лимит загрузок пользователя — 429 с Retry-After', async () => {
    const files = Array.from({ length: 31 }, (_, i) =>
      Buffer.concat([fixture('komoot.gpx'), Buffer.from(`<!-- ${i} -->`)]),
    );
    const statuses: number[] = [];
    for (const bytes of files) statuses.push((await uploadTrack(h, auth, bytes)).status);
    expect(statuses.slice(0, 30).every((status) => status === 202)).toBe(true);
    const limited = await uploadTrack(h, auth, fixture('strava.gpx'));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('AC3: идемпотентность и дедуп', () => {
  it('тот же файл дважды — один документ, второй ответ 200 с тем же id; повтор задачи после ready — no-op', async () => {
    const bytes = fixture('komoot.gpx');
    const first = await uploadTrack(h, auth, bytes);
    const second = await uploadTrack(h, auth, bytes);
    expect([first.status, second.status]).toEqual([202, 200]);
    expect(parsedUpload(second).id).toBe(parsedUpload(first).id);
    expect(await tracks(h).uploads.countDocuments()).toBe(1);
    expect(await storedFiles()).toHaveLength(1);

    const id = parsedUpload(first).id;
    expect(await processUpload(h, id)).toBe('ready');
    const before = await tracks(h).uploads.findOne({ _id: id });
    expect(await processUpload(h, id)).toBe('skipped');
    expect(await tracks(h).uploads.findOne({ _id: id })).toEqual(before);
    expect(await tracks(h).activities.countDocuments()).toBe(1);
  });

  it('заезд файлом и из агрегатора — одна основная (с мощностью), другая duplicate; повтор ingest — тот же', async () => {
    const file = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
    expect(await processUpload(h, file.id)).toBe('ready');

    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const input = {
      userId,
      source: 'wahoo' as const,
      via: 'open_wearables' as const,
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000001',
      stream: owStream({ provider: 'wahoo', hasPower: true }),
    };
    const streamed = await ingest.ingestProviderStream(input);
    expect(streamed.created).toBe(true);
    expect(await ingest.ingestProviderStream(input)).toEqual({ ...streamed, created: false });
    expect(await processUpload(h, streamed.uploadId)).toBe('ready');

    const uploads = await tracks(h).uploads.find().sort({ _id: 1 }).toArray();
    expect(uploads.map((upload) => [upload.source, upload.format, upload.status])).toEqual([
      ['upload', 'gpx', 'duplicate'],
      ['wahoo', 'stream', 'ready'],
    ]);
    const activities = await tracks(h).activities.find().toArray();
    const primary = activities.find((activity) => activity.duplicateOf === null);
    expect(primary?.source).toBe('wahoo');
    expect(activities.filter((activity) => activity.duplicateOf === primary?._id)).toHaveLength(1);
  });

  /**
   * Гонка (R7): две вставки одного заезда — ворота после чтения кандидатов первой; вторая завершается целиком. С
   * замком `lockUserActivities` вторая конфликтует и видит первую — одна основная. Отрицательное доказательство:
   * без замка обе не видят друг друга — две основные.
   */
  async function raceTwoUploads(withLock: boolean) {
    const a = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
    const b = parsedUpload(
      await uploadTrack(
        h,
        auth,
        Buffer.concat([fixture('garmin-connect.gpx'), Buffer.from('<!-- copy -->')]),
      ),
    );
    const repository = h.worker.get(TracksRepository);
    const original = repository.dedupCandidates.bind(repository);
    const g = gate();
    let first = true;
    const candidates = vi
      .spyOn(repository, 'dedupCandidates')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        if (first) {
          first = false;
          await g.wait();
        }
        return result;
      });
    const lock = vi.spyOn(repository, 'lockUserActivities');
    if (!withLock) lock.mockResolvedValue(undefined);
    try {
      const pa = processUpload(h, a.id);
      await g.reached;
      const pb = processUpload(h, b.id);
      // вторая упирается в замок первой (повтор транзакции) или — без замка — завершается
      await untilBlocked(pb, () => Promise.resolve(lock.mock.calls.length >= 3));
      g.open();
      await Promise.all([pa, pb]);
    } finally {
      candidates.mockRestore();
      lock.mockRestore();
    }
    return tracks(h).activities.find({ duplicateOf: null }).toArray();
  }

  it('две параллельные вставки одного заезда — ровно одна основная (замок lockUserActivities)', async () => {
    expect(await raceTwoUploads(true)).toHaveLength(1);
    expect(await tracks(h).activities.countDocuments()).toBe(2);
  });

  it('отрицательное доказательство: без замка — две основные', async () => {
    expect(await raceTwoUploads(false)).toHaveLength(2);
  });
});

describe('AC4: квота и уборка', () => {
  it('квота исчерпана — 503 TRACK_STORAGE_FULL, файл не записан', async () => {
    const quota = h.env.TRACK_STORAGE_MAX_BYTES;
    // окружение стенда — общий объект ENV (useValue): уменьшаем квоту на время теста
    h.env.TRACK_STORAGE_MAX_BYTES = 1000;
    try {
      const full = await uploadTrack(h, auth, fixture('komoot.gpx'));
      expect(full.status).toBe(503);
      expect(full.body).toMatchObject({ code: 'TRACK_STORAGE_FULL' });
      expect(await storedFiles()).toEqual([]);
      expect(await tracks(h).uploads.countDocuments()).toBe(0);
    } finally {
      h.env.TRACK_STORAGE_MAX_BYTES = quota;
    }
  });

  it('уборка: исходники отбракованных старше 7 дней и файлы без документа старше 1 ч', async () => {
    const failed = parsedUpload(await uploadTrack(h, auth, fixture('corrupted-crc.fit')));
    expect(await processUpload(h, failed.id)).toBe('failed');
    const ready = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    expect(await processUpload(h, ready.id)).toBe('ready');

    const store = h.worker.get<TrackFileStore>(TRACK_FILE_STORE);
    const orphanOld = newStorageKey('fit');
    const orphanFresh = newStorageKey('gpx');
    await store.put(orphanOld, new Uint8Array([1]));
    await store.put(orphanFresh, new Uint8Array([2]));
    const tmp = join(TRACK_STORAGE_DIR_TEST, 'zz', 'partial.fit.tmp');
    await mkdir(join(TRACK_STORAGE_DIR_TEST, 'zz'), { recursive: true });
    await writeFile(tmp, 'x');

    h.clock.advance(8 * DAY);
    const old = new Date(h.clock.now().getTime() - 2 * HOUR);
    await utimes(join(TRACK_STORAGE_DIR_TEST, orphanOld), old, old);
    await utimes(tmp, old, old);
    const fresh = h.clock.now();
    await utimes(join(TRACK_STORAGE_DIR_TEST, orphanFresh), fresh, fresh);
    const readyDoc = await tracks(h).uploads.findOne({ _id: ready.id });
    await utimes(join(TRACK_STORAGE_DIR_TEST, readyDoc?.storageKey ?? ''), old, old);

    const result = await h.worker.get(TracksMaintenanceProcessor).cleanup();
    expect(result).toEqual({ rejectedFiles: 1, orphanFiles: 2 });
    expect(await tracks(h).uploads.findOne({ _id: failed.id })).toMatchObject({
      status: 'failed',
      storageKey: null,
    });
    expect((await storedFiles()).sort()).toEqual([orphanFresh, readyDoc?.storageKey].sort());
    expect(await readdir(join(TRACK_STORAGE_DIR_TEST, 'zz'))).toEqual([]);
  });
});

describe('AC5: удаление загрузки', () => {
  it('загрузка, активность, линия и файл удалены; основной группы становится следующий; источник агрегатора — событие', async () => {
    const file = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
    expect(await processUpload(h, file.id)).toBe('ready');
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const streamed = await ingest.ingestProviderStream({
      userId,
      source: 'garmin',
      via: 'open_wearables',
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000002',
      stream: owStream({ hasPower: true }),
    });
    expect(await processUpload(h, streamed.uploadId)).toBe('ready');
    const primary = await tracks(h).uploads.findOne({ _id: streamed.uploadId });

    const deleted = await call(
      h,
      'POST',
      `/v1/tracks/uploads/${streamed.uploadId}/delete`,
      {},
      auth,
    );
    expect(deleted.status).toBe(204);
    expect(await tracks(h).uploads.findOne({ _id: streamed.uploadId })).toBeNull();
    expect(await tracks(h).activities.countDocuments({ uploadId: streamed.uploadId })).toBe(0);
    expect(await tracks(h).tracks.countDocuments()).toBe(1);
    expect(await storedFiles()).not.toContain(primary?.storageKey);
    // бывший дубль стал основным
    expect(await tracks(h).uploads.findOne({ _id: file.id })).toMatchObject({ status: 'ready' });
    expect(await tracks(h).activities.findOne({ uploadId: file.id })).toMatchObject({
      duplicateOf: null,
    });
    const events = await outboxEvents(h);
    expect(events.map((event) => [event.type, event.payload])).toContainEqual([
      'tracks.upload-deleted',
      {
        uploadId: streamed.uploadId,
        userId,
        source: 'garmin',
        sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000002',
      },
    ]);
    // ручная загрузка — без события
    expect((await call(h, 'POST', `/v1/tracks/uploads/${file.id}/delete`, {}, auth)).status).toBe(
      204,
    );
    expect(
      (await outboxEvents(h)).filter((event) => event.type === 'tracks.upload-deleted'),
    ).toHaveLength(1);
    expect(await storedFiles()).toEqual([]);
  });

  it('удаление во время разбора — разбор ничего не пишет (нет воскрешения)', async () => {
    const upload = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    const transactions = h.worker.get(MongoTransactions);
    const run = transactions.run.bind(transactions);
    const spy = vi.spyOn(transactions, 'run').mockImplementationOnce(async (fn) => {
      expect(
        (await call(h, 'POST', `/v1/tracks/uploads/${upload.id}/delete`, {}, auth)).status,
      ).toBe(204);
      return run(fn);
    });
    try {
      expect(await processUpload(h, upload.id)).toBe('skipped');
    } finally {
      spy.mockRestore();
    }
    expect(await tracks(h).uploads.countDocuments()).toBe(0);
    expect(await tracks(h).activities.countDocuments()).toBe(0);
  });
});

describe('AC13: ответы без служебных полей', () => {
  it('список: курсор, новые сверху; без sha256, storageKey, sourceRef, координат и биометрии', async () => {
    const ids: string[] = [];
    for (const name of ['komoot.gpx', 'strava.gpx', 'garmin-edge-ride.fit']) {
      const upload = parsedUpload(await uploadTrack(h, auth, fixture(name)));
      await processUpload(h, upload.id);
      ids.push(upload.id);
    }
    const first = await call(h, 'GET', '/v1/tracks/uploads?limit=2', undefined, auth);
    expect(first.headers['cache-control']).toBe('no-store');
    const page = TrackUploadPage.parse(first.body);
    expect(page.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    const second = TrackUploadPage.parse(
      (
        await call(
          h,
          'GET',
          `/v1/tracks/uploads?limit=2&cursor=${page.nextCursor}`,
          undefined,
          auth,
        )
      ).body,
    );
    expect(second).toEqual({ items: [expect.objectContaining({ id: ids[0] })], nextCursor: null });

    const raw = JSON.stringify(first.body);
    for (const field of [
      'sha256',
      'storageKey',
      'sourceRef',
      'userId',
      'coordinates',
      'hasPower',
      'hasHeartRate',
      'startPoint',
    ]) {
      expect(raw).not.toContain(field);
    }
    expect(Object.keys((first.body as { items: object[] }).items[0] ?? {}).sort()).toEqual([
      'activity',
      'createdAt',
      'failure',
      'fileName',
      'format',
      'id',
      'source',
      'status',
    ]);
  });
});

describe('ревью pass 1: финальные отказы, маркер удаления, 413, уборка дублей', () => {
  it('HIGH-1: исходник пропал из хранилища — failed: storage, а не вечное processing', async () => {
    const upload = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    const doc = await tracks(h).uploads.findOne({ _id: upload.id });
    await rm(join(TRACK_STORAGE_DIR_TEST, doc?.storageKey ?? ''));
    expect(await processUpload(h, upload.id)).toBe('failed');
    expect(await tracks(h).uploads.findOne({ _id: upload.id })).toMatchObject({
      status: 'failed',
      failure: 'storage',
    });
  });

  it('HIGH-1: сбой потока разбора — ретрай; на последней попытке — failed: unreadable', async () => {
    const upload = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    const processor = h.worker.get(TrackProcessingProcessor);
    const analyze = vi.spyOn(processor, 'analyze').mockRejectedValue(new Error('thread crashed'));
    try {
      await expect(processor.processUpload(upload.id)).rejects.toThrow('thread crashed');
      expect(await tracks(h).uploads.findOne({ _id: upload.id })).toMatchObject({
        status: 'processing',
        failure: null,
      });
      expect(await processor.processUpload(upload.id, { finalAttempt: true })).toBe('failed');
    } finally {
      analyze.mockRestore();
    }
    expect(await tracks(h).uploads.findOne({ _id: upload.id })).toMatchObject({
      status: 'failed',
      failure: 'unreadable',
      attempts: 2,
    });
  });

  it('HIGH-4: удалённый пользователем объект источника не воскресает при повторе приёма', async () => {
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const input = {
      userId,
      source: 'garmin' as const,
      via: 'open_wearables' as const,
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000009',
      stream: owStream(),
    };
    const first = await ingest.ingestProviderStream(input);
    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${first.uploadId}/delete`, {}, auth)).status,
    ).toBe(204);
    await expect(ingest.ingestProviderStream(input)).rejects.toBeInstanceOf(
      TrackSourceDeletedError,
    );
    expect(await tracks(h).uploads.countDocuments()).toBe(0);
    expect(await storedFiles()).toEqual([]);
    // другой объект того же провайдера принимается
    const other = await ingest.ingestProviderStream({
      ...input,
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000010',
    });
    expect(other.created).toBe(true);
  });

  it('HIGH-4: удаление закоммитилось между ранней проверкой и транзакцией приёма — отказ, без загрузки', async () => {
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const input = {
      userId,
      source: 'wahoo' as const,
      via: 'open_wearables' as const,
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000011',
      stream: owStream({ provider: 'wahoo' }),
    };
    const first = await ingest.ingestProviderStream(input);
    const repository = h.worker.get(TracksRepository);
    const early = vi.spyOn(repository, 'isSourceRefDeleted');
    // ранняя проверка «не удалён» устарела: удаление пройдёт до транзакции приёма
    early.mockResolvedValueOnce(false);
    const findBySource = vi.spyOn(repository, 'findUploadBySourceRef');
    findBySource.mockImplementationOnce(async () => {
      expect(
        (await call(h, 'POST', `/v1/tracks/uploads/${first.uploadId}/delete`, {}, auth)).status,
      ).toBe(204);
      return undefined;
    });
    try {
      await expect(ingest.ingestProviderStream(input)).rejects.toBeInstanceOf(
        TrackSourceDeletedError,
      );
    } finally {
      early.mockRestore();
      findBySource.mockRestore();
    }
    expect(await tracks(h).uploads.countDocuments()).toBe(0);
  });

  it('MEDIUM-9: уборка не трогает исходник duplicate (он станет основным при удалении основной)', async () => {
    const file = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
    expect(await processUpload(h, file.id)).toBe('ready');
    const streamed = await h.worker.get<TrackIngest>(TRACK_INGEST).ingestProviderStream({
      userId,
      source: 'wahoo',
      via: 'open_wearables',
      sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-000000000012',
      stream: owStream({ provider: 'wahoo', hasPower: true }),
    });
    expect(await processUpload(h, streamed.uploadId)).toBe('ready');
    expect(await tracks(h).uploads.findOne({ _id: file.id })).toMatchObject({
      status: 'duplicate',
    });
    h.clock.advance(8 * DAY);
    expect(await h.worker.get(TracksMaintenanceProcessor).cleanup()).toEqual({
      rejectedFiles: 0,
      orphanFiles: 0,
    });
    const duplicate = await tracks(h).uploads.findOne({ _id: file.id });
    expect(duplicate?.storageKey).not.toBeNull();
    expect(await storedFiles()).toContain(duplicate?.storageKey);
  });

  it('MEDIUM-6: > 16 МиБ через настоящий сокет — ответ 413 с кодом контракта и Connection: close, без обрыва', async () => {
    await h.app.listen(0, '127.0.0.1');
    const address = h.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/v1/tracks/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...auth },
      body: new Uint8Array(17 * 1024 * 1024).fill(0x20),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('connection')).toBe('close');
    expect(await response.json()).toMatchObject({ code: 'TRACK_TOO_LARGE' });
    expect(await tracks(h).uploads.countDocuments()).toBe(0);
  });
});
