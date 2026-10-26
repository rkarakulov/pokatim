import { rm } from 'node:fs/promises';

import { MyRaceEntry } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import { call, gate, retried, untilBlocked } from '../../../test/identity';
import {
  addAttempt,
  corridorRace,
  enterRace,
  myEntry,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  signIn,
  travelTo,
  uploadRide,
  WINDOW,
  withdraw,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { parsedUpload, processUpload, tracks, uploadTrack } from '../../../test/tracks';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { AttemptIntake } from './attempt-intake';
import { ResultsRepository } from './results.repository';

/**
 * Попытки (race-results-03: AC6–AC12): автоматические по событиям `tracks` и заявке, явные «выбрать свой заезд» и
 * «загрузить в гонку», дубли, удаление, сроки и пределы. Окно гонки — 24.10 00:00 — 26.10 23:59 Минска; заезд
 * эталона (`corridor/*.gpx`) сдвинут на 25.10 09:00 Минска.
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
const code = (body: unknown) => (body as { code?: string }).code;

/** Гонка, заявленный райдер, часы — после заезда (новый access). */
async function entered() {
  const race = await corridorRace(h);
  const r = await rider(h);
  expect((await enterRace(h, r.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  return { ...race, ...r, auth: await signIn(h, r.email), worker };
}

const attempts = () => resultsDb(h).attempts.find().sort({ _id: 1 }).toArray();

describe('автоматические попытки (AC6)', () => {
  it('заезд в окне и в рамке маршрута → auto queued → counted без действий райдера', async () => {
    const { raceId, auth, worker } = await entered();
    const ride = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    expect(ride.outcome).toBe('ready');
    await worker.intake();
    expect(await attempts()).toMatchObject([
      { activityId: ride.activityId, origin: 'auto', status: 'queued', checkRevision: 1 },
    ]);
    const queued = await myEntry(h, auth, raceId);
    expect(queued.result.status).toBe('pending');
    expect(queued.attempts.map((attempt) => attempt.status)).toEqual(['queued']);
    await worker.drain();
    const view = await myEntry(h, auth, raceId);
    expect(view.result).toMatchObject({
      status: 'provisional',
      elapsedSec: 790,
      place: 1,
      ranked: 1,
    });
    expect(view.attempts[0]).toMatchObject({ origin: 'auto', status: 'counted', isBest: true });
  });

  it('вне рамки, indoor, вне окна — попытки нет', async () => {
    const { auth, worker } = await entered();
    await uploadRide(h, auth, rideGpx('far-away.gpx', RIDE));
    await uploadRide(
      h,
      auth,
      rideGpx('clean.gpx', new Date(RIDE.getTime() - HOUR), { type: 'indoor_cycling' }),
    );
    // до окна: 23.10 08:00 Минска
    await uploadRide(h, auth, rideGpx('clean.gpx', new Date('2026-10-23T05:00:00Z')));
    await worker.drain();
    expect(await tracks(h).activities.countDocuments()).toBe(3);
    expect(await attempts()).toEqual([]);
  });

  it('без заявки и с отменённой заявкой — попытки нет', async () => {
    const { raceId, auth, worker } = await entered();
    expect((await withdraw(h, auth, raceId)).status).toBe(200);
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    const other = await rider(h, 'other@example.com');
    await uploadRide(h, other.auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    expect(await attempts()).toEqual([]);
  });

  it('файл принят после закрытия окна + 24 ч — попытки нет (время приёма сервером)', async () => {
    const { raceId, worker } = await entered();
    travelTo(h, new Date(WINDOW.closesAt.getTime() + DAY));
    const late = await signIn(h, 'rider@example.com');
    await uploadRide(h, late, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    expect(await attempts()).toEqual([]);
    const view = await myEntry(h, late, raceId);
    expect(view.result.status).toBe('dns');
    expect(view.actions.reasons).toContain('upload_closed');
  });
});

describe('заявка после заезда (AC7)', () => {
  it('entry-created подхватывает заезд в окне', async () => {
    const { raceId } = await corridorRace(h);
    const r = await rider(h);
    travelTo(h, AFTER_RIDE);
    const auth = await signIn(h, r.email);
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    const worker = resultsWorker(h);
    await worker.drain();
    expect(await attempts()).toEqual([]);
    expect((await enterRace(h, auth, raceId)).status).toBe(201);
    await worker.drain();
    expect(await attempts()).toMatchObject([{ origin: 'auto', status: 'counted' }]);
  });
});

describe('«выбрать свой заезд» (AC8)', () => {
  it('явная попытка по activityId; отказ явной — виден с причиной', async () => {
    const { raceId, auth, worker } = await entered();
    const ride = await uploadRide(h, auth, rideGpx('far-away.gpx', RIDE));
    await worker.drain();
    expect(await attempts()).toEqual([]);
    const res = await addAttempt(h, auth, raceId, { activityId: ride.activityId });
    expect(res.status).toBe(200);
    expect(MyRaceEntry.parse(res.body).attempts).toMatchObject([
      { origin: 'explicit', status: 'queued' },
    ]);
    await worker.drain();
    const view = await myEntry(h, auth, raceId);
    expect(view.attempts).toMatchObject([
      { origin: 'explicit', status: 'rejected', reasons: ['no_start'] },
    ]);
    expect(view.result.status).toBe('not_counted');
    const candidates = await call(
      h,
      'GET',
      `/v1/races/${raceId}/attempt-candidates`,
      undefined,
      auth,
    );
    expect(candidates.body).toEqual({
      items: [expect.objectContaining({ activityId: ride.activityId, attempted: true })],
    });
  });

  it('существующая auto становится explicit без перепроверки: скрытый отказ — виден', async () => {
    const { raceId, auth, worker } = await entered();
    const ride = await uploadRide(h, auth, rideGpx('stop-80pct.gpx', RIDE));
    await worker.drain();
    const [auto] = await attempts();
    expect(auto).toMatchObject({
      origin: 'auto',
      status: 'rejected',
      reasons: ['no_finish'],
      matched: false,
    });
    expect((await myEntry(h, auth, raceId)).attempts).toEqual([]);
    await addAttempt(h, auth, raceId, { activityId: ride.activityId });
    expect(await worker.drain()).toBe(0);
    expect(await attempts()).toMatchObject([
      { _id: auto!._id, origin: 'explicit', status: 'rejected', checkRevision: 1 },
    ]);
    expect((await myEntry(h, auth, raceId)).attempts).toMatchObject([
      { id: auto!._id, reasons: ['no_finish'] },
    ]);
  });

  it('чужая и неизвестная активность — 404; дубль группы — 409 ATTEMPT_SOURCE_INVALID', async () => {
    const { raceId, auth } = await entered();
    const other = await rider(h, 'other@example.com');
    const foreign = await uploadRide(h, other.auth, rideGpx('clean.gpx', RIDE));
    expect((await addAttempt(h, auth, raceId, { activityId: foreign.activityId })).status).toBe(
      404,
    );
    expect(
      (await addAttempt(h, auth, raceId, { activityId: '01890a5d-ac96-774b-bcce-b302099a8057' }))
        .status,
    ).toBe(404);
    const plain = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { power: true }));
    const duplicate = await addAttempt(h, auth, raceId, { activityId: plain.activityId });
    expect([duplicate.status, code(duplicate.body)]).toEqual([409, 'ATTEMPT_SOURCE_INVALID']);
    expect((await addAttempt(h, auth, raceId, { activityId: 'x' })).status).toBe(400);
    expect((await addAttempt(h, auth, raceId, {})).status).toBe(400);
  });
});

describe('«загрузить в гонку» (AC9)', () => {
  it('до разбора — запрос ждёт файл; по готовности — explicit; отказ файла — статус и причина', async () => {
    const { raceId, auth, worker } = await entered();
    const upload = parsedUpload(await uploadTrack(h, auth, rideGpx('far-away.gpx', RIDE)));
    const waiting = MyRaceEntry.parse(
      (await addAttempt(h, auth, raceId, { uploadId: upload.id })).body,
    );
    expect(waiting.pendingUploads).toEqual([
      { uploadId: upload.id, status: 'queued', failure: null },
    ]);
    expect(await processUpload(h, upload.id)).toBe('ready');
    await worker.drain();
    const view = await myEntry(h, auth, raceId);
    expect(view.pendingUploads).toEqual([]);
    expect(view.attempts).toMatchObject([{ origin: 'explicit', status: 'rejected' }]);
    const entry = await resultsDb(h).entries.findOne();
    expect(entry?.requests).toMatchObject([
      { uploadId: upload.id, attemptId: view.attempts[0]!.id },
    ]);

    const broken = parsedUpload(
      await uploadTrack(h, auth, Buffer.from('<gpx><trk><trkseg></trkseg></trk></gpx>')),
    );
    await addAttempt(h, auth, raceId, { uploadId: broken.id });
    await processUpload(h, broken.id);
    const failed = await myEntry(h, auth, raceId);
    expect(failed.pendingUploads).toEqual([
      { uploadId: broken.id, status: 'failed', failure: expect.any(String) },
    ]);
    const direct = await addAttempt(h, auth, raceId, { uploadId: broken.id });
    expect([direct.status, code(direct.body)]).toEqual([409, 'ATTEMPT_SOURCE_INVALID']);
  });

  /**
   * Запрос по загрузке ↔ `activity-ready`: запрос прочитал «файл разбирается» и остановлен (ворота); разбор и приём
   * попытки идут целиком — без запроса предфильтр (далеко от маршрута) попытки не даёт. Под `lockEntry` приём
   * конфликтует с запросом и после его коммита видит запрос — попытка `explicit`. Отрицательное доказательство: без
   * замка запрос навсегда «ждёт файл».
   */
  it('гонка запроса и activity-ready — запрос не теряется', async () => {
    const { raceId, auth, worker } = await entered();
    const upload = parsedUpload(await uploadTrack(h, auth, rideGpx('far-away.gpx', RIDE)));
    const source = h.app.get<ActivitySource>(ACTIVITY_SOURCE, { strict: false });
    const g = gate();
    const uploadState = source.uploadState.bind(source);
    vi.spyOn(source, 'uploadState').mockImplementationOnce(async (...args) => {
      const state = await uploadState(...args);
      await g.wait();
      return state;
    });
    const requesting = addAttempt(h, auth, raceId, { uploadId: upload.id });
    await g.reached;
    expect(await processUpload(h, upload.id)).toBe('ready');
    const lockSpy = vi.spyOn(h.worker.get(ResultsRepository), 'lockEntry');
    const intake = worker.intake();
    await untilBlocked(intake, retried(lockSpy));
    g.open();
    const [requested] = await Promise.all([requesting, intake]);
    expect(requested.status).toBe(200);
    const entry = await resultsDb(h).entries.findOne();
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ origin: 'explicit', uploadId: upload.id });
    expect(entry?.requests).toMatchObject([{ uploadId: upload.id, attemptId: attempt?._id }]);
  });
});

describe('дубли и удаление (AC10, AC11)', () => {
  it('новая основная (с мощностью) → прежняя withdrawn: not_primary, новая проверяется; запрос по дублю — к основной', async () => {
    const { raceId, auth, worker } = await entered();
    const first = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    const powered = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { power: true }));
    await worker.drain();
    expect((await attempts()).map((a) => [a.activityId, a.status, a.withdrawReason])).toEqual([
      [first.activityId, 'withdrawn', 'not_primary'],
      [powered.activityId, 'counted', null],
    ]);
    // запрос по загрузке-дублю относится к основной группы
    const res = await addAttempt(h, auth, raceId, { uploadId: first.uploadId });
    expect(res.status).toBe(200);
    const all = await attempts();
    expect(all[1]).toMatchObject({ activityId: powered.activityId, origin: 'explicit' });
    expect((await resultsDb(h).entries.findOne())?.requests).toMatchObject([
      { uploadId: first.uploadId, activityId: first.activityId, attemptId: all[1]!._id },
    ]);
  });

  it('удаление заезда → withdrawn: activity_removed, лучший пересчитан; дубль, ставший основным, — попытка оживает', async () => {
    const { raceId, auth, worker } = await entered();
    const first = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    const powered = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { power: true }));
    await worker.drain();
    expect((await myEntry(h, auth, raceId)).result.status).toBe('provisional');

    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${powered.uploadId}/delete`, {}, auth)).status,
    ).toBe(204);
    await worker.intake();
    const byActivity = new Map((await attempts()).map((a) => [a.activityId, a]));
    expect(byActivity.get(powered.activityId!)).toMatchObject({
      status: 'withdrawn',
      withdrawReason: 'activity_removed',
    });
    expect(byActivity.get(first.activityId!)).toMatchObject({ status: 'queued', checkRevision: 2 });
    expect((await myEntry(h, auth, raceId)).result.status).toBe('pending');
    await worker.drain();
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'provisional',
      elapsedSec: 790,
    });

    expect(
      (await call(h, 'POST', `/v1/tracks/uploads/${first.uploadId}/delete`, {}, auth)).status,
    ).toBe(204);
    await worker.drain();
    const view = await myEntry(h, auth, raceId);
    expect(view.result).toMatchObject({ status: 'none', elapsedSec: null, place: null });
    expect(view.attempts).toEqual([]);
  });
});

describe('сроки и пределы (AC12)', () => {
  it('до окна — ATTEMPT_UPLOAD_CLOSED window_not_open; после срока — upload_closed; без заявки — RACE_ENTRY_REQUIRED', async () => {
    const { raceId } = await corridorRace(h);
    const r = await rider(h);
    const body = { activityId: '01890a5d-ac96-774b-bcce-b302099a8057' };
    expect(code((await addAttempt(h, r.auth, raceId, body)).body)).toBe('RACE_ENTRY_REQUIRED');
    await enterRace(h, r.auth, raceId);
    const early = await addAttempt(h, r.auth, raceId, body);
    expect([early.status, code(early.body), (early.body as { details: unknown }).details]).toEqual([
      409,
      'ATTEMPT_UPLOAD_CLOSED',
      { reason: 'window_not_open' },
    ]);
    travelTo(h, new Date(WINDOW.closesAt.getTime() + DAY));
    const late = await addAttempt(h, await signIn(h, r.email), raceId, body);
    expect((late.body as { details: unknown }).details).toEqual({ reason: 'upload_closed' });
  });

  it('31-я явная попытка — ATTEMPT_LIMIT; автоматическая сверх предела — пропуск', async () => {
    const { raceId, auth, worker, userId } = await entered();
    const entry = await resultsDb(h).entries.findOne();
    const base = (await resultsDb(h).attempts.findOne()) ?? null;
    expect(base).toBeNull();
    const now = h.clock.now();
    await resultsDb(h).attempts.insertMany(
      Array.from({ length: 30 }, (_, i) => ({
        _id: `01890a5d-ac96-774b-bcce-b3020990${String(i).padStart(4, '0')}`,
        raceId,
        entryId: entry!._id,
        userId,
        activityId: `01890a5d-ac96-774b-bcce-b3020991${String(i).padStart(4, '0')}`,
        uploadId: `01890a5d-ac96-774b-bcce-b3020992${String(i).padStart(4, '0')}`,
        activity: { startedAt: RIDE, source: 'upload' as const, elapsedSec: 1, distanceM: 1 },
        origin: 'auto' as const,
        status: 'rejected' as const,
        matched: false,
        reasons: ['no_start' as const],
        failure: null,
        withdrawReason: null,
        segment: null,
        touchedCorridor: false,
        candidates: 0,
        diagnostics: null,
        engineVersion: 1,
        corridor: { routeId: 'r', widthM: 50 },
        checkRevision: 1,
        checkAttempts: 1,
        requeues: 0,
        createdAt: now,
        updatedAt: now,
        checkedAt: now,
      })),
    );
    const warn = vi.spyOn(h.worker.get(AttemptIntake)['logger'], 'warn');
    const ride = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    expect(await resultsDb(h).attempts.countDocuments()).toBe(30);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt limit'));
    const res = await addAttempt(h, auth, raceId, { activityId: ride.activityId });
    expect([res.status, code(res.body)]).toEqual([409, 'ATTEMPT_LIMIT']);
  });
});
