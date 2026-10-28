import { rm } from 'node:fs/promises';

import { RouteRideDetail, RouteRideTrack } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { catalogCorridorRoute, ridesUrl, routeRidesDb } from '../../../test/route-rides';
import { rideGpx, rider, signIn, travelTo, uploadRide } from '../../../test/results';
import { routesDb } from '../../../test/routes';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { trackFileStore, tracks } from '../../../test/tracks';
import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';
import { RouteRideCheckProcessor } from './route-ride-check.processor';

/**
 * Worker сверки заезда по маршруту (route-rides-01, §7 шаг 8): эталон в потоке разбора, сбои потока и окружения,
 * ревизии, невидимый маршрут, зависшие проверки, разметка трека. Процессор вызывается напрямую (`check`).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  processor().parseLimits = DEFAULT_PARSE_LIMITS;
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const OTHER = '01890a5d-ac96-774b-bcce-b30209900002';
const RIDE_AT = new Date('2026-10-15T06:00:00Z');
const processor = () => h.worker.get(RouteRideCheckProcessor);

/** Райдер, маршрут каталога и заезд `clean.gpx` в очереди (ревизия 1). */
async function queuedRide() {
  const r = await rider(h);
  const routeId = await catalogCorridorRoute(h, OTHER);
  const upload = await uploadRide(h, r.auth, rideGpx('clean.gpx', RIDE_AT));
  const res = await call(h, 'POST', ridesUrl(routeId), { activityId: upload.activityId }, r.auth);
  expect(res.status).toBe(201);
  return { ...r, routeId, upload, rideId: RouteRideDetail.parse(res.body).id };
}

const docOf = async (id: string) => (await routeRidesDb(h).rides.findOne({ _id: id }))!;

async function trackOf(auth: Record<string, string>, routeId: string, rideId: string) {
  const res = await call(h, 'GET', ridesUrl(routeId, `/${rideId}/track`), undefined, auth);
  expect(res.status).toBe(200);
  return RouteRideTrack.parse(res.body);
}

describe('сверка заезда (worker)', () => {
  it('/track: pending до проверки, ready после (сегмент, сход), unavailable у failed', async () => {
    const w = await queuedRide();
    expect(await trackOf(w.auth, w.routeId, w.rideId)).toMatchObject({
      rideId: w.rideId,
      segment: null,
      offRuns: [],
      marks: 'pending',
    });
    expect(await processor().check(w.rideId, 1)).toBe('passed');
    const ready = await trackOf(w.auth, w.routeId, w.rideId);
    const line = await tracks(h).tracks.findOne({ _id: w.upload.activityId! });
    expect(ready.line).toEqual(line!.line.coordinates);
    expect(ready.marks).toBe('ready');
    expect(ready.segment).toEqual({ from: expect.any(Number), to: expect.any(Number) });
    expect(ready.offRuns).toEqual([]);
    expect(await docOf(w.rideId)).toMatchObject({ status: 'passed', checkAttempts: 1 });

    await routeRidesDb(h).rides.updateOne(
      { _id: w.rideId },
      { $set: { status: 'failed', failure: 'storage', trackMap: null } },
    );
    expect((await trackOf(w.auth, w.routeId, w.rideId)).marks).toBe('unavailable');
  });

  it('крошечный таймаут потока → failed: timeout; implausible → not_passed', async () => {
    const w = await queuedRide();
    processor().parseLimits = { ...DEFAULT_PARSE_LIMITS, timeoutMs: 1 };
    expect(await processor().check(w.rideId, 1)).toBe('failed');
    expect(await docOf(w.rideId)).toMatchObject({ status: 'failed', failure: 'timeout' });

    const again = await call(
      h,
      'POST',
      ridesUrl(w.routeId),
      { activityId: w.upload.activityId },
      w.auth,
    );
    expect(again.status).toBe(200);
    processor().parseLimits = DEFAULT_PARSE_LIMITS;
    vi.spyOn(processor(), 'analyze').mockResolvedValueOnce({ ok: false, code: 'implausible' });
    expect(await processor().check(w.rideId, 2)).toBe('not_passed');
    expect(await docOf(w.rideId)).toMatchObject({
      status: 'not_passed',
      reasons: ['implausible'],
      failure: null,
      segment: null,
    });
  });

  it('сбой окружения: не финальная попытка — проброс (ретрай), финальная — failed: error', async () => {
    const w = await queuedRide();
    vi.spyOn(processor(), 'analyze').mockRejectedValue(new Error('loader crashed'));
    await expect(processor().check(w.rideId, 1)).rejects.toThrow('loader crashed');
    expect(await docOf(w.rideId)).toMatchObject({ status: 'checking' });
    expect(await processor().check(w.rideId, 1, { finalAttempt: true })).toBe('failed');
    expect(await docOf(w.rideId)).toMatchObject({
      status: 'failed',
      failure: 'error',
      checkAttempts: 2,
    });
  });

  it('исходник пропал из хранилища → failed: storage', async () => {
    const w = await queuedRide();
    const upload = await tracks(h).uploads.findOne({ _id: w.upload.uploadId });
    await trackFileStore(h).delete(upload!.storageKey!);
    expect(await processor().check(w.rideId, 1)).toBe('failed');
    expect(await docOf(w.rideId)).toMatchObject({ failure: 'storage' });
  });

  it('маршрут стал невидим до проверки → failed: corridor_invalid; повтор после возврата — passed', async () => {
    const w = await queuedRide();
    const catalog = (await routesDb(h).routes.findOne({ _id: w.routeId }))!.catalog;
    await routesDb(h).routes.updateOne({ _id: w.routeId }, { $set: { catalog: null } });
    const analyze = vi.spyOn(processor(), 'analyze');
    expect(await processor().check(w.rideId, 1)).toBe('failed');
    expect(analyze).not.toHaveBeenCalled();
    expect(await docOf(w.rideId)).toMatchObject({ failure: 'corridor_invalid' });

    await routesDb(h).routes.updateOne({ _id: w.routeId }, { $set: { catalog } });
    expect(
      (await call(h, 'POST', ridesUrl(w.routeId), { activityId: w.upload.activityId }, w.auth))
        .status,
    ).toBe(200);
    expect(await processor().check(w.rideId, 2)).toBe('passed');
  });

  it('ревизии: поздняя задача прежней ревизии и повтор после итога — skipped', async () => {
    const w = await queuedRide();
    expect(await processor().check(w.rideId, 2)).toBe('skipped');
    expect(await processor().check(w.rideId, 1)).toBe('passed');
    expect(await processor().check(w.rideId, 1)).toBe('skipped');
  });

  it('зависший checking (> 15 мин): GET — failed/error, POST перепоставляет новой ревизией; граница — строго больше', async () => {
    const w = await queuedRide();
    await routeRidesDb(h).rides.updateOne(
      { _id: w.rideId },
      { $set: { status: 'checking', updatedAt: h.clock.now() } },
    );
    travelTo(h, new Date(h.clock.now().getTime() + 15 * MINUTE));
    let auth = await signIn(h, w.email);
    const get = async () =>
      RouteRideDetail.parse(
        (await call(h, 'GET', ridesUrl(w.routeId, `/${w.rideId}`), undefined, auth)).body,
      );
    expect(await get()).toMatchObject({ status: 'checking', failure: null });
    expect((await trackOf(auth, w.routeId, w.rideId)).marks).toBe('pending');
    // на границе POST не перепоставляет
    expect(
      (await call(h, 'POST', ridesUrl(w.routeId), { activityId: w.upload.activityId }, auth))
        .status,
    ).toBe(200);
    expect((await docOf(w.rideId)).checkRevision).toBe(1);

    travelTo(h, new Date(h.clock.now().getTime() + 1000));
    auth = await signIn(h, w.email);
    expect(await get()).toMatchObject({ status: 'failed', failure: 'error' });
    expect((await trackOf(auth, w.routeId, w.rideId)).marks).toBe('unavailable');
    const retry = await call(
      h,
      'POST',
      ridesUrl(w.routeId),
      { activityId: w.upload.activityId },
      auth,
    );
    expect(retry.status).toBe(200);
    expect(RouteRideDetail.parse(retry.body).status).toBe('queued');
    expect(await docOf(w.rideId)).toMatchObject({ status: 'queued', checkRevision: 2 });
    expect(await processor().check(w.rideId, 2)).toBe('passed');
  });

  it('зависший queued (> 2 ч) — failed/error при чтении', async () => {
    const w = await queuedRide();
    travelTo(h, new Date(h.clock.now().getTime() + 2 * 60 * MINUTE + 1000));
    const auth = await signIn(h, w.email);
    const res = await call(h, 'GET', ridesUrl(w.routeId, `/${w.rideId}`), undefined, auth);
    expect(RouteRideDetail.parse(res.body)).toMatchObject({ status: 'failed', failure: 'error' });
  });
});
