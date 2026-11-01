import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, HOUR, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { importRide, rider, rideGpx, uploadRide } from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { tracks } from '../../../test/tracks';
import { ACTIVITY_STARTS, type ActivityStarts } from './index';

/**
 * Порт `ACTIVITY_STARTS` для `social` (автоявка, P5, RC-P5-2): старт основной группы дублей — по id любой активности
 * группы; владелец — из состояния `tracks` (параметра `userId` у порта нет); нет активности — `null`.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const port = () => h.worker.get<ActivityStarts>(ACTIVITY_STARTS, { strict: false });
const startAt = () => new Date(h.clock.now().getTime() - 2 * HOUR);

describe('ActivityStarts.primaryStart', () => {
  it('одиночная активность — свой старт, вид спорта и владелец', async () => {
    const a = await rider(h, 'a@example.by');
    const at = startAt();
    const { activityId } = await uploadRide(h, a.auth, rideGpx('clean.gpx', at));

    const start = await port().primaryStart(activityId!);
    expect(start).toEqual({
      activityId,
      userId: a.userId,
      sport: 'cycling',
      startedAt: at,
      // первая точка `clean.gpx`
      startPoint: [27.55759373, 53.90062966],
    });
  });

  it('дубль (Garmin без датчиков после файла с power) — по id дубля возвращается основная', async () => {
    const a = await rider(h, 'a@example.by');
    const gpx = rideGpx('clean.gpx', startAt(), { power: true });
    const primary = await uploadRide(h, a.auth, gpx);
    const duplicate = await importRide(h, a.userId, gpx, { hasHeartRate: false, hasPower: false });
    expect((await tracks(h).activities.findOne({ _id: duplicate.activityId! }))?.duplicateOf).toBe(
      primary.activityId,
    );

    expect(await port().primaryStart(duplicate.activityId!)).toMatchObject({
      activityId: primary.activityId,
      userId: a.userId,
    });
    expect((await port().primaryStart(primary.activityId!))?.activityId).toBe(primary.activityId);
  });

  it('владелец ответа — владелец активности, а не кто-то другой', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    const own = await uploadRide(h, a.auth, rideGpx('clean.gpx', startAt()));
    const other = await uploadRide(h, b.auth, rideGpx('clean.gpx', startAt()));
    expect((await port().primaryStart(own.activityId!))?.userId).toBe(a.userId);
    expect((await port().primaryStart(other.activityId!))?.userId).toBe(b.userId);
  });

  it('удалённая загрузка — null', async () => {
    const a = await rider(h, 'a@example.by');
    const { uploadId, activityId } = await uploadRide(h, a.auth, rideGpx('clean.gpx', startAt()));
    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${uploadId}/delete`, {}, a.auth)).status,
    ).toBe(204);
    expect(await port().primaryStart(activityId!)).toBeNull();
  });
});
