import { rm } from 'node:fs/promises';

import { MyAttemptTrack } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { publishedRace, staff } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  signIn,
  travelTo,
  uploadRide,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { tracks } from '../../../test/tracks';

/**
 * Свой трек попытки (maps-02, AC3/AC4): `GET /v1/races/:raceId/entry/attempts/:attemptId/track` — только владельцу,
 * `no-store`, разметка из `trackMap` попытки; чужая, скрытая, снятая, другой гонки, неизвестная — один 404.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const RIDE = new Date('2026-10-25T06:00:00Z');
const AFTER_RIDE = new Date('2026-10-25T08:00:00Z');
const UNKNOWN = '01890a5d-ac96-774b-bcce-b302099a8057';
const trackUrl = (raceId: string, attemptId: string) =>
  `/v1/races/${raceId}/entry/attempts/${attemptId}/track`;

/** Райдер с попыткой `wobble-3pct` (сход): `check` — выполнить проверку. */
async function withAttempt({ check = true } = {}) {
  const race = await corridorRace(h);
  const r = await rider(h);
  expect((await enterRace(h, r.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  const auth = await signIn(h, r.email);
  const ride = await uploadRide(h, auth, rideGpx('wobble-3pct.gpx', RIDE));
  if (check) await worker.drain();
  else await worker.intake();
  const attempt = (await resultsDb(h).attempts.findOne({ activityId: ride.activityId! }))!;
  return { ...race, auth, ride, attempt };
}

const get = (raceId: string, attemptId: string, auth: Record<string, string>) =>
  call(h, 'GET', trackUrl(raceId, attemptId), undefined, auth);

describe('свой трек попытки (maps-02)', () => {
  it('владелец — 200, no-store, ключи ровно attemptId/line/segment/offRuns/marks; разметка ready', async () => {
    const { raceId, auth, ride, attempt } = await withAttempt();
    expect(attempt.status).toBe('rejected');
    const res = await get(raceId, attempt._id, auth);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['attemptId', 'line', 'marks', 'offRuns', 'segment'].sort(),
    );
    const body = MyAttemptTrack.parse(res.body);
    const stored = await tracks(h).tracks.findOne({ _id: ride.activityId! });
    expect(body.line).toEqual(stored!.line.coordinates);
    expect(body).toMatchObject({ attemptId: attempt._id, marks: 'ready' });
    expect(body.segment).toEqual({
      from: attempt.trackMap!.segment![0],
      to: attempt.trackMap!.segment![1],
    });
    expect(body.offRuns).toEqual(attempt.trackMap!.offRuns.map(([from, to]) => ({ from, to })));
    expect(body.offRuns.length).toBeGreaterThan(0);
  });

  it('queued — pending; без trackMap (до maps-02) и несовпадение linePoints — unavailable', async () => {
    const queued = await withAttempt({ check: false });
    const pending = MyAttemptTrack.parse(
      (await get(queued.raceId, queued.attempt._id, queued.auth)).body,
    );
    expect(pending).toMatchObject({ marks: 'pending', segment: null, offRuns: [] });

    await resultsWorker(h).drain();
    const attempts = resultsDb(h).attempts;
    await attempts.updateOne({ _id: queued.attempt._id }, { $inc: { 'trackMap.linePoints': 1 } });
    expect(
      MyAttemptTrack.parse((await get(queued.raceId, queued.attempt._id, queued.auth)).body),
    ).toMatchObject({ marks: 'unavailable', segment: null, offRuns: [] });
    await attempts.updateOne({ _id: queued.attempt._id }, { $unset: { trackMap: '' } });
    expect(
      MyAttemptTrack.parse((await get(queued.raceId, queued.attempt._id, queued.auth)).body),
    ).toMatchObject({ marks: 'unavailable', segment: null, offRuns: [] });
  });

  it('чужая, скрытая auto, снятая, другой гонки, неизвестная, линия удалена — 404 NOT_FOUND одним телом', async () => {
    const { raceId, auth, ride, attempt } = await withAttempt();
    const notFound = async (res: { status: number; body: unknown }) => {
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('NOT_FOUND');
      return JSON.stringify(res.body);
    };
    const bodies = new Set<string>();
    const stranger = await rider(h, 'stranger@example.com');
    bodies.add(await notFound(await get(raceId, attempt._id, stranger.auth)));
    bodies.add(await notFound(await get(raceId, UNKNOWN, auth)));
    // сессия админа подготовки истекла после перевода часов — второй админ
    const other = await publishedRace(h, (await staff(h, 'admin2@example.by', 'admin')).token);
    bodies.add(await notFound(await get(other.id, attempt._id, auth)));

    const attempts = resultsDb(h).attempts;
    await attempts.updateOne({ _id: attempt._id }, { $set: { matched: false } });
    bodies.add(await notFound(await get(raceId, attempt._id, auth)));
    await attempts.updateOne(
      { _id: attempt._id },
      { $set: { matched: true, status: 'withdrawn', withdrawReason: 'activity_removed' } },
    );
    bodies.add(await notFound(await get(raceId, attempt._id, auth)));
    await attempts.updateOne({ _id: attempt._id }, { $set: { status: 'rejected' } });
    expect((await get(raceId, attempt._id, auth)).status).toBe(200);
    await tracks(h).tracks.deleteOne({ _id: ride.activityId! });
    bodies.add(await notFound(await get(raceId, attempt._id, auth)));
    expect(bodies.size).toBe(1);
  });

  it('без входа — 401; невалидный id гонки или попытки — 400', async () => {
    const { raceId, auth, attempt } = await withAttempt({ check: false });
    expect((await call(h, 'GET', trackUrl(raceId, attempt._id))).status).toBe(401);
    expect((await get('not-a-uuid', attempt._id, auth)).status).toBe(400);
    expect((await get(raceId, 'not-a-uuid', auth)).status).toBe(400);
  });
});
