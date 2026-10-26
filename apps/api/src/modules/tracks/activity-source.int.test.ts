import { rm } from 'node:fs/promises';

import { TrackStreamV1 } from '@pokatim/tracks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, outboxEvents, signUpSession, userIdByEmail } from '../../../test/identity';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { fixture, parsedUpload, processUpload, tracks, uploadTrack } from '../../../test/tracks';
import { ACTIVITY_SOURCE, type ActivitySource } from './activity-source.port';
import { TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import { TRACK_INGEST, type TrackIngest } from './track-ingest.port';

/** События `tracks.activity-ready/-removed` и порт `ActivitySource` (race-results-03). */

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
  auth = bearer((await signUpSession(h)).accessToken);
  userId = await userIdByEmail(h);
});

const source = () => h.worker.get<ActivitySource>(ACTIVITY_SOURCE);
const owStream = (overrides: Partial<TrackStreamV1> = {}): TrackStreamV1 => ({
  ...TrackStreamV1.parse(JSON.parse(fixture('ow-stream.json').toString('utf8'))),
  ...overrides,
});
const eventsOf = async (type: string) =>
  (await outboxEvents(h)).filter((event) => event.type === type).map((event) => event.payload);

/** Файл GPX и тот же заезд из агрегатора с мощностью (станет основным). */
async function fileAndStream() {
  const file = parsedUpload(await uploadTrack(h, auth, fixture('garmin-connect.gpx')));
  expect(await processUpload(h, file.id)).toBe('ready');
  const streamed = await h.worker.get<TrackIngest>(TRACK_INGEST).ingestProviderStream({
    userId,
    source: 'garmin',
    via: 'open_wearables',
    sourceRef: '0b0e0c2a-1d1d-4d4d-8e8e-0000000000aa',
    stream: owStream({ hasPower: true }),
  });
  expect(await processUpload(h, streamed.uploadId)).toBe('ready');
  const fileActivity = await tracks(h).activities.findOne({ uploadId: file.id });
  const streamActivity = await tracks(h).activities.findOne({ uploadId: streamed.uploadId });
  return { file, streamed, fileActivity: fileActivity!, streamActivity: streamActivity! };
}

describe('события outbox', () => {
  it('activity-ready — на каждую записанную активность (ручная загрузка и поток агрегатора, дубль тоже)', async () => {
    const { file, streamed, fileActivity, streamActivity } = await fileAndStream();
    expect(await eventsOf('tracks.activity-ready')).toEqual([
      { activityId: fileActivity._id, uploadId: file.id, userId },
      { activityId: streamActivity._id, uploadId: streamed.uploadId, userId },
    ]);
  });

  it('отказ разбора — без события; повтор задачи после итога — без второго события', async () => {
    const bad = parsedUpload(await uploadTrack(h, auth, fixture('no-time.gpx')));
    expect(await processUpload(h, bad.id)).toBe('failed');
    const good = parsedUpload(await uploadTrack(h, auth, fixture('komoot.gpx')));
    expect(await processUpload(h, good.id)).toBe('ready');
    expect(await processUpload(h, good.id)).toBe('skipped');
    expect(await eventsOf('tracks.activity-ready')).toHaveLength(1);
  });

  it('activity-removed — с новой основной группы; удаление дубля и без активности — primary null / без события', async () => {
    const { file, streamed, fileActivity, streamActivity } = await fileAndStream();
    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${streamed.uploadId}/delete`, {}, auth)).status,
    ).toBe(204);
    expect((await call(h, 'POST', `/v1/tracks/uploads/${file.id}/delete`, {}, auth)).status).toBe(
      204,
    );
    const failed = parsedUpload(await uploadTrack(h, auth, fixture('no-time.gpx')));
    await processUpload(h, failed.id);
    expect((await call(h, 'POST', `/v1/tracks/uploads/${failed.id}/delete`, {}, auth)).status).toBe(
      204,
    );
    expect(await eventsOf('tracks.activity-removed')).toEqual([
      {
        activityId: streamActivity._id,
        uploadId: streamed.uploadId,
        userId,
        primaryActivityId: fileActivity._id,
      },
      { activityId: fileActivity._id, uploadId: file.id, userId, primaryActivityId: null },
    ]);
  });
});

describe('activity-removed при удалении дубля', () => {
  it('удалён дубль — primaryActivityId = прежняя основная группы (подписчик пересобирает группу)', async () => {
    const { file, fileActivity, streamActivity } = await fileAndStream();
    expect((await call(h, 'POST', `/v1/tracks/uploads/${file.id}/delete`, {}, auth)).status).toBe(
      204,
    );
    expect(await eventsOf('tracks.activity-removed')).toEqual([
      {
        activityId: fileActivity._id,
        uploadId: file.id,
        userId,
        primaryActivityId: streamActivity._id,
      },
    ]);
  });
});

describe('порт ActivitySource', () => {
  it('group: состояние сейчас — основная и дубль, время приёма файла, рамка линии', async () => {
    const { file, streamed, fileActivity, streamActivity } = await fileAndStream();
    const group = await source().group(fileActivity._id);
    expect(group?.userId).toBe(userId);
    const byId = new Map(group?.members.map((member) => [member.id, member]));
    expect(byId.get(streamActivity._id)).toMatchObject({
      isPrimary: true,
      primaryId: streamActivity._id,
      uploadId: streamed.uploadId,
      source: 'garmin',
    });
    expect(byId.get(fileActivity._id)).toMatchObject({
      isPrimary: false,
      primaryId: streamActivity._id,
      uploadId: file.id,
      uploadCreatedAt: new Date(file.createdAt),
    });
    const [minLon, minLat, maxLon, maxLat] = byId.get(fileActivity._id)!.bounds;
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
    expect(await source().group('01890a5d-ac96-774b-bcce-b302099a8057')).toBeNull();
  });

  it('владение: чужая и неизвестная активность/загрузка — null', async () => {
    const { file, fileActivity } = await fileAndStream();
    const stranger = '01890a5d-ac96-774b-bcce-b302099a8099';
    expect(await source().activity(userId, fileActivity._id)).toMatchObject({
      id: fileActivity._id,
    });
    expect(await source().activity(stranger, fileActivity._id)).toBeNull();
    expect(await source().uploadState(userId, file.id)).toMatchObject({
      status: 'duplicate',
      failure: null,
      activity: { id: fileActivity._id, isPrimary: false },
    });
    expect(await source().uploadState(stranger, file.id)).toBeNull();
    expect([...(await source().uploadStates(stranger, [file.id])).keys()]).toEqual([]);
    expect((await source().uploadStates(userId, [file.id])).get(file.id)).toEqual({
      status: 'duplicate',
      failure: null,
    });
  });

  it('listInRange — только основные, пересекающие интервал; readSource — байты и формат, нет файла — null', async () => {
    const { streamActivity, fileActivity } = await fileAndStream();
    const from = new Date(streamActivity.startedAt.getTime() + 60_000);
    const to = new Date(streamActivity.endedAt.getTime() + 3_600_000);
    expect((await source().listInRange(userId, from, to, 50)).map((a) => a.id)).toEqual([
      streamActivity._id,
    ]);
    expect(await source().listInRange(userId, streamActivity.endedAt, to, 50)).toEqual([]);

    const read = await source().readSource(fileActivity._id);
    expect(read?.format).toBe('gpx');
    expect(Buffer.from(read!.bytes)).toEqual(fixture('garmin-connect.gpx'));

    const upload = await tracks(h).uploads.findOne({ _id: fileActivity.uploadId });
    await h.worker.get<TrackFileStore>(TRACK_FILE_STORE).delete(upload!.storageKey!);
    expect(await source().readSource(fileActivity._id)).toBeNull();
    expect(await source().readSource('01890a5d-ac96-774b-bcce-b302099a8057')).toBeNull();
  });
});
