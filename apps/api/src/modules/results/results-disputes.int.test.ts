import { rm } from 'node:fs/promises';

import { MyRaceEntry, PanelRaceStandings, RaceResultsPage } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeSeededDispute, seedDispute } from '../../../test/disputes';
import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { RACES } from '../../../test/races';
import {
  addAttempt,
  corridorRace,
  enterRace,
  myEntry,
  panelResults,
  protocolAction,
  protocolRace,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  signIn,
  travelTo,
  uploadRide,
  withdraw,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { parsedUpload, processUpload, uploadTrack } from '../../../test/tracks';

/**
 * Споры в `results` (race-results-06, точка B): D-39 (отмена участия, явная попытка, заморозка приёма — RC-5), DQ
 * по спору до публикации (RC-6, RC-16), строка чек-листа «открытые споры». Споры вставляются напрямую в коллекцию —
 * подачу проверяет модуль `disputes`.
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
const failure = (res: { status: number; body: unknown }) => {
  const body = res.body as { code?: string; details?: { reason?: string } };
  return [res.status, body.code, body.details?.reason];
};

/** Гонка, заявленный райдер, часы — в окне после заезда (новый access). */
async function entered() {
  const race = await corridorRace(h);
  const r = await rider(h);
  const entry = MyRaceEntry.parse((await enterRace(h, r.auth, race.raceId)).body).entry!;
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  return { ...race, ...r, entryId: entry.id, auth: await signIn(h, r.email), worker };
}

const attempts = () => resultsDb(h).attempts.find().sort({ _id: 1 }).toArray();

describe('D-39: открытый спор по своему результату (AC7)', () => {
  it('actions — dispute_open; отмена участия — 409 RACE_WITHDRAW_CLOSED dispute_open; после закрытия спора — можно', async () => {
    const { raceId, auth, entryId } = await entered();
    const dispute = await seedDispute(h, { raceId, targetEntryId: entryId });
    expect((await myEntry(h, auth, raceId)).actions).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['dispute_open'],
    });
    expect(failure(await withdraw(h, auth, raceId))).toEqual([
      409,
      'RACE_WITHDRAW_CLOSED',
      'dispute_open',
    ]);
    expect((await resultsDb(h).entries.findOne({ _id: entryId }))?.status).toBe('active');

    await closeSeededDispute(h, dispute._id);
    expect((await myEntry(h, auth, raceId)).actions).toMatchObject({
      canWithdraw: true,
      canAddAttempt: true,
      reasons: [],
    });
    expect((await withdraw(h, auth, raceId)).status).toBe(200);
  });

  it('спор против чужой заявки действия не закрывает', async () => {
    const { raceId, auth } = await entered();
    await seedDispute(h, { raceId, targetEntryId: '01890a5d-ac96-774b-bcce-b302099a8057' });
    expect((await myEntry(h, auth, raceId)).actions.reasons).toEqual([]);
  });

  it('явная попытка (activityId и uploadId) — 409 ATTEMPT_UPLOAD_CLOSED dispute_open; после закрытия — 200', async () => {
    const { raceId, auth, entryId, worker } = await entered();
    const ride = await uploadRide(h, auth, rideGpx('far-away.gpx', RIDE));
    await worker.drain();
    const dispute = await seedDispute(h, { raceId, targetEntryId: entryId });
    expect(failure(await addAttempt(h, auth, raceId, { activityId: ride.activityId }))).toEqual([
      409,
      'ATTEMPT_UPLOAD_CLOSED',
      'dispute_open',
    ]);
    expect(failure(await addAttempt(h, auth, raceId, { uploadId: ride.uploadId }))).toEqual([
      409,
      'ATTEMPT_UPLOAD_CLOSED',
      'dispute_open',
    ]);
    expect(await attempts()).toEqual([]);

    await closeSeededDispute(h, dispute._id);
    expect((await addAttempt(h, auth, raceId, { activityId: ride.activityId })).status).toBe(200);
    expect(await attempts()).toMatchObject([{ origin: 'explicit' }]);
  });
});

describe('D-39: приём при открытом споре (RC-5)', () => {
  it('авто-активность попытки не создаёт; после закрытия спора сама не появляется — райдер выбирает заезд явно', async () => {
    const { raceId, auth, entryId, worker } = await entered();
    const dispute = await seedDispute(h, { raceId, targetEntryId: entryId });
    const ride = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    expect(await attempts()).toEqual([]);

    await closeSeededDispute(h, dispute._id);
    await worker.drain();
    expect(await attempts()).toEqual([]);
    expect((await addAttempt(h, auth, raceId, { activityId: ride.activityId })).status).toBe(200);
    await worker.drain();
    expect((await myEntry(h, auth, raceId)).result.status).toBe('provisional');
  });

  it('дубль с более высоким приоритетом не снимает оспоренный результат (not_primary заморожен)', async () => {
    const { raceId, auth, entryId, worker } = await entered();
    const first = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    expect((await myEntry(h, auth, raceId)).result.status).toBe('provisional');
    await seedDispute(h, { raceId, targetEntryId: entryId });
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { power: true }));
    await worker.drain();
    expect((await attempts()).map((a) => [a.activityId, a.status])).toEqual([
      [first.activityId, 'counted'],
    ]);
    expect((await myEntry(h, auth, raceId)).result.status).toBe('provisional');
  });

  it('«загрузить в гонку», принятая до подачи спора, после разбора даёт попытку', async () => {
    const { raceId, auth, entryId, worker } = await entered();
    const upload = parsedUpload(await uploadTrack(h, auth, rideGpx('clean.gpx', RIDE)));
    expect((await addAttempt(h, auth, raceId, { uploadId: upload.id })).status).toBe(200);
    await seedDispute(h, { raceId, targetEntryId: entryId });
    expect(await processUpload(h, upload.id)).toBe('ready');
    await worker.drain();
    expect(await attempts()).toMatchObject([
      { origin: 'explicit', uploadId: upload.id, status: 'counted' },
    ]);
  });
});

describe('DQ по спору до публикации (D-43, RC-6, RC-16)', () => {
  /** Пометка DQ заявки напрямую (решение спора проверяет `disputes`). */
  const markDq = (entryId: string) =>
    resultsDb(h).entries.updateOne(
      { _id: entryId },
      { $set: { disqualified: { at: h.clock.now(), disputeId: entryId } } },
    );

  it('моё участие — dq без места со временем; действия — disqualified; отмена участия — 409 disqualified', async () => {
    const { raceId, auth, entryId, worker } = await entered();
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.drain();
    await markDq(entryId);
    const view = await myEntry(h, auth, raceId);
    expect(view.result).toMatchObject({
      status: 'dq',
      place: null,
      tied: false,
      elapsedSec: expect.any(Number),
      ranked: 0,
    });
    expect(view.actions).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['disqualified'],
    });
    expect(failure(await withdraw(h, auth, raceId))).toEqual([
      409,
      'RACE_WITHDRAW_CLOSED',
      'disqualified',
    ]);
  });

  it('таблица и места — без DQ; «Участники» панели — DQ в прочих со статусом dq; чек-лист — открытые споры', async () => {
    const { raceId, riders, token } = await protocolRace(h, [3600, 3700, 3800]);
    await markDq(riders[0]!.entryId);
    const table = RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${raceId}/results`)).body);
    expect(table.ranked).toBe(2);
    expect(table.items.map((row) => [row.entryId, row.place])).toEqual([
      [riders[1]!.entryId, 1],
      [riders[2]!.entryId, 2],
    ]);
    const auth = await signIn(h, riders[1]!.email);
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({ place: 1, ranked: 2 });

    const standings = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${raceId}/standings`)).body,
    );
    expect(standings.items.map((row) => [row.entryId, row.resultStatus, row.place])).toEqual([
      [riders[1]!.entryId, 'provisional', 1],
      [riders[2]!.entryId, 'provisional', 2],
      [riders[0]!.entryId, 'dq', null],
    ]);

    await seedDispute(h, { raceId, targetEntryId: riders[2]!.entryId });
    await seedDispute(h, { raceId, targetEntryId: riders[1]!.entryId });
    const summary = await panelResults(h, token, raceId);
    expect(summary.publish.checklist.find((row) => row.code === 'open_disputes')?.count).toBe(2);
    expect(summary.publish.canPublish).toBe(false);
    const refused = await protocolAction(h, token, raceId, '/protocol');
    expect([refused.status, (refused.body as { code: string }).code]).toEqual([
      409,
      'RESULTS_PUBLISH_BLOCKED',
    ]);
  });
});

describe('гейт обязателен (RC-1)', () => {
  it('без споров чтения и действия работают как прежде', async () => {
    const { raceId, auth } = await entered();
    expect((await myEntry(h, auth, raceId)).actions.reasons).toEqual([]);
    const other = await rider(h, 'other@example.com');
    expect((await enterRace(h, other.auth, raceId)).status).toBe(201);
  });
});
