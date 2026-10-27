import { rm } from 'node:fs/promises';

import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import { PanelRaceAttemptPage, PanelRaceResults } from '@pokatim/contracts';
import { CORRIDOR_ENGINE_VERSION, FLAGS_VERSION } from '@pokatim/tracks/parse';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { gate, retried, untilBlocked } from '../../../test/identity';
import { panelCall, panelSession } from '../../../test/panel';
import { QUEUE } from '../../queues';
import { RACES } from '../../../test/races';
import {
  addAttempt,
  corridorExpected,
  corridorRace,
  enterRace,
  importRide,
  myEntry,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  seedVerifiedProfile,
  signIn,
  travelTo,
  uploadRide,
} from '../../../test/results';
import { routesDb } from '../../../test/routes';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { trackFileStore, tracks } from '../../../test/tracks';
import { AttemptCheckProcessor } from './attempt-check.processor';
import {
  RESULTS_REQUEUE_STUCK_JOB,
  ResultsMaintenanceProcessor,
} from './results-maintenance.processor';
import { ResultsRecheck } from './results-recheck';
import { ResultsRepository } from './results.repository';

/**
 * Проверка попыток (race-results-03: AC13–AC17): эталоны движка в потоке разбора, ревизии, сбои, зависшие проверки,
 * лучший результат при параллельных вердиктах. Заезд эталона сдвинут в окно гонки стенда (25.10 09:00 Минска).
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
const processor = () => h.worker.get(AttemptCheckProcessor);
/** Момент запроса перепроверки — после вердиктов, записанных «сейчас» (часы стенда стоят). */
const justAfter = () => new Date(h.clock.now().getTime() + 1);
const attempts = () => resultsDb(h).attempts.find().sort({ _id: 1 }).toArray();

async function entered() {
  const race = await corridorRace(h);
  const r = await rider(h);
  expect((await enterRace(h, r.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  return { ...race, ...r, auth: await signIn(h, r.email), worker };
}

/** Заезд с попыткой в очереди (приём выполнен, проверка — нет). */
async function queuedAttempt(name = 'clean.gpx') {
  const ctx = await entered();
  const ride = await uploadRide(h, ctx.auth, rideGpx(name, RIDE));
  await ctx.worker.intake();
  const [attempt] = await attempts();
  expect(attempt).toMatchObject({ status: 'queued', checkRevision: 1 });
  return { ...ctx, ride, attempt: attempt! };
}

describe('эталоны движка в attempt-check (AC13)', () => {
  it('clean — counted, время эталона; engineVersion, checkedAt, diagnostics записаны', async () => {
    const { attempt, raceId, auth } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    const expected = corridorExpected.fixtures['clean.gpx']!.expected;
    const checked = await resultsDb(h).attempts.findOne({ _id: attempt._id });
    expect(checked).toMatchObject({
      status: 'counted',
      reasons: [],
      matched: true,
      engineVersion: CORRIDOR_ENGINE_VERSION,
      checkedAt: h.clock.now(),
      checkAttempts: 1,
      touchedCorridor: true,
    });
    expect(Math.abs(checked!.segment!.elapsedSec - expected.elapsedSec!)).toBeLessThanOrEqual(1);
    expect(checked!.diagnostics).toMatchObject({ geometryLimited: false });
    expect(checked!.segment).not.toHaveProperty('points');
    const entry = await resultsDb(h).entries.findOne();
    expect(entry?.best).toMatchObject({
      attemptId: attempt._id,
      elapsedSec: checked!.segment!.elapsedSec,
    });
    expect(entry?.summary).toEqual({
      total: 1,
      pending: 0,
      counted: 1,
      rejectedShown: 0,
      failed: 0,
      excluded: 0,
    });
    expect((await myEntry(h, auth, raceId)).attempts[0]?.segment?.elapsedSec).toBe(
      checked!.segment!.elapsedSec,
    );
  });

  it('wobble-3pct — rejected off_corridor с долей вне коридора эталона (видимый отказ auto)', async () => {
    const { attempt, raceId, auth } = await queuedAttempt('wobble-3pct.gpx');
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    const expected = corridorExpected.fixtures['wobble-3pct.gpx']!.expected;
    const checked = await resultsDb(h).attempts.findOne({ _id: attempt._id });
    expect(checked).toMatchObject({ status: 'rejected', reasons: ['off_corridor'], matched: true });
    expect(checked!.segment!.offCorridorShare).toBeCloseTo(expected.offCorridorShare!, 3);
    const view = await myEntry(h, auth, raceId);
    expect(view.attempts).toMatchObject([{ status: 'rejected', reasons: ['off_corridor'] }]);
    expect(view.result.status).toBe('not_counted');
  });

  it('без полного сегмента (mid-start: no_start) — auto скрыта от райдера, явная — видна', async () => {
    const { attempt, raceId, auth, ride } = await queuedAttempt('mid-start.gpx');
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      reasons: ['no_start'],
      matched: false,
    });
    const hidden = await myEntry(h, auth, raceId);
    expect(hidden.attempts).toEqual([]);
    expect(hidden.result.status).toBe('none');
    await addAttempt(h, auth, raceId, { activityId: ride.activityId });
    expect((await myEntry(h, auth, raceId)).attempts).toMatchObject([
      { origin: 'explicit', reasons: ['no_start'] },
    ]);
  });
});

describe('событие видимого вердикта для уведомлений (notifications RC-2)', () => {
  const verdictEvents = () =>
    h.db
      .collection('outbox')
      .find({ type: 'results.attempt-verdict-changed' })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
  const stored = (id: string) => resultsDb(h).attempts.findOne({ _id: id });
  const recheck = (raceId: string) => h.worker.get(ResultsRecheck).requestRace(raceId, justAfter());

  it('первый видимый вердикт — событие; перепроверка с тем же статусом — без второго', async () => {
    const { attempt, raceId } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    expect((await verdictEvents()).map((event) => event.payload)).toEqual([
      { attemptId: attempt._id, raceId, userId: attempt.userId, status: 'counted' },
    ]);
    expect((await stored(attempt._id))?.lastVisibleVerdict).toBe('counted');
    expect(await recheck(raceId)).toBe(1);
    // новая ревизия не стирает прежний видимый вердикт
    expect(await stored(attempt._id)).toMatchObject({
      status: 'queued',
      lastVisibleVerdict: 'counted',
    });
    expect(await processor().check(attempt._id, 2)).toBe('counted');
    expect(await verdictEvents()).toHaveLength(1);
  });

  it('counted → rejected (видимый) — второе событие со статусом rejected', async () => {
    const { attempt, raceId } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    // явная попытка: неправдоподобный файл виден райдеру (подготовка — origin в БД)
    await resultsDb(h).attempts.updateOne({ _id: attempt._id }, { $set: { origin: 'explicit' } });
    await recheck(raceId);
    const analyze = vi
      .spyOn(processor(), 'analyze')
      .mockResolvedValueOnce({ ok: false, code: 'implausible' });
    expect(await processor().check(attempt._id, 2)).toBe('rejected');
    analyze.mockRestore();
    expect((await verdictEvents()).map((event) => event.payload.status)).toEqual([
      'counted',
      'rejected',
    ]);
    expect((await stored(attempt._id))?.lastVisibleVerdict).toBe('rejected');
  });

  it('скрытая авто-попытка (no_start) — без события, видимого вердикта нет', async () => {
    const { attempt } = await queuedAttempt('mid-start.gpx');
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    expect(await verdictEvents()).toEqual([]);
    expect((await stored(attempt._id))?.lastVisibleVerdict).toBeNull();
  });

  it('провал после засчитанной — без события и прежний вердикт не затирается; снова counted — без события', async () => {
    const { attempt, raceId } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    await recheck(raceId);
    const analyze = vi
      .spyOn(processor(), 'analyze')
      .mockResolvedValueOnce({ ok: false, code: 'timeout' });
    expect(await processor().check(attempt._id, 2)).toBe('failed');
    analyze.mockRestore();
    expect(await stored(attempt._id)).toMatchObject({
      status: 'failed',
      lastVisibleVerdict: 'counted',
    });
    await recheck(raceId);
    expect(await processor().check(attempt._id, 3)).toBe('counted');
    expect(await verdictEvents()).toHaveLength(1);
  });

  it('повтор задачи после итога (skipped) — без второго события', async () => {
    const { attempt } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    expect(await processor().check(attempt._id, 1)).toBe('skipped');
    expect(await verdictEvents()).toHaveLength(1);
  });
});

describe('разметка трека попытки (maps-02)', () => {
  const stored = (id: string) => resultsDb(h).attempts.findOne({ _id: id });
  const lineOf = async (activityId: string) =>
    (await tracks(h).tracks.findOne({ _id: activityId }))!.line.coordinates;

  it('wobble-3pct — trackMap с участками схода на линии activity_tracks; только позиции, без координат и времени', async () => {
    const { attempt, ride } = await queuedAttempt('wobble-3pct.gpx');
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    const { trackMap } = (await stored(attempt._id))!;
    expect(Object.keys(trackMap!).sort()).toEqual(['linePoints', 'offRuns', 'segment']);
    const line = await lineOf(ride.activityId!);
    expect(trackMap!.linePoints).toBe(line.length);
    const [from, to] = trackMap!.segment!;
    expect(trackMap!.offRuns.length).toBeGreaterThan(0);
    for (const [a, b] of trackMap!.offRuns) {
      expect(a).toBeGreaterThanOrEqual(from);
      expect(b).toBeLessThanOrEqual(to);
      expect(b).toBeGreaterThan(a);
    }
    // позиции — индексы линии, не координаты и не время
    const values = [from, to, ...trackMap!.offRuns.flat()];
    expect(values.every((value) => typeof value === 'number' && value <= line.length - 1)).toBe(
      true,
    );
  });

  it('clean — сегмент задан, схода нет; mid-start (no_start) — null', async () => {
    const clean = await queuedAttempt();
    expect(await processor().check(clean.attempt._id, 1)).toBe('counted');
    const { trackMap } = (await stored(clean.attempt._id))!;
    expect(trackMap!.offRuns).toEqual([]);
    expect(trackMap!.segment).not.toBeNull();
    await h.reset();
    const midStart = await queuedAttempt('mid-start.gpx');
    expect(await processor().check(midStart.attempt._id, 1)).toBe('rejected');
    expect((await stored(midStart.attempt._id))!.trackMap).toBeNull();
  });

  it('новая попытка и перепостановка — null до вердикта; провалы (таймаут, implausible, storage) — null', async () => {
    const { attempt, ride } = await queuedAttempt('wobble-3pct.gpx');
    expect((await stored(attempt._id))!.trackMap).toBeNull();
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    expect((await stored(attempt._id))!.trackMap).not.toBeNull();
    await h.worker.get(ResultsRecheck).requestRace(attempt.raceId, justAfter());
    expect(await stored(attempt._id)).toMatchObject({ status: 'queued', trackMap: null });

    const analyze = vi
      .spyOn(processor(), 'analyze')
      .mockResolvedValueOnce({ ok: false, code: 'timeout' })
      .mockResolvedValueOnce({ ok: false, code: 'implausible' });
    expect(await processor().check(attempt._id, 2)).toBe('failed');
    expect((await stored(attempt._id))!.trackMap).toBeNull();
    await h.worker.get(ResultsRecheck).requestRace(attempt.raceId, justAfter());
    expect(await processor().check(attempt._id, 3)).toBe('rejected');
    expect(await stored(attempt._id)).toMatchObject({ reasons: ['implausible'], trackMap: null });
    analyze.mockRestore();

    await h.worker.get(ResultsRecheck).requestRace(attempt.raceId, justAfter());
    const upload = await tracks(h).uploads.findOne({ _id: ride.uploadId });
    await trackFileStore(h).delete(upload!.storageKey!);
    expect(await processor().check(attempt._id, 4)).toBe('failed');
    expect(await stored(attempt._id)).toMatchObject({ failure: 'storage', trackMap: null });
  });

  it('линии активности нет — вердикт есть, trackMap: null', async () => {
    const { attempt, ride } = await queuedAttempt('wobble-3pct.gpx');
    await tracks(h).tracks.deleteOne({ _id: ride.activityId! });
    expect(await processor().check(attempt._id, 1)).toBe('rejected');
    expect(await stored(attempt._id)).toMatchObject({ reasons: ['off_corridor'], trackMap: null });
  });
});

describe('ревизии проверки (AC14)', () => {
  /**
   * Повтор задачи после итога и поздняя задача старой ревизии — no-op. Отрицательное доказательство: без
   * `checkRevision` в фильтрах захвата и записи старая задача проверяет и пишет поверх новой ревизии.
   */
  it('повтор после итога и старая ревизия после перепроверки — skipped', async () => {
    const { attempt, raceId } = await queuedAttempt();
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    expect(await processor().check(attempt._id, 1)).toBe('skipped');
    expect(await h.worker.get(ResultsRecheck).requestRace(raceId, justAfter())).toBe(1);
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'queued',
      checkRevision: 2,
      segment: null,
    });
    expect((await resultsDb(h).entries.findOne())?.best).toBeNull();
    expect(await processor().check(attempt._id, 1)).toBe('skipped');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'queued',
      checkRevision: 2,
      checkAttempts: 1,
    });
    expect(await processor().check(attempt._id, 2)).toBe('counted');
    expect(await processor().check(attempt._id, 1)).toBe('skipped');
    const events = await h.db
      .collection('outbox')
      .find({ type: 'results.attempt-check-requested' })
      .toArray();
    expect(events.map((event) => event.payload)).toEqual([
      { attemptId: attempt._id, checkRevision: 1 },
      { attemptId: attempt._id, checkRevision: 2 },
    ]);
  });
});

describe('сбои проверки (AC15)', () => {
  it('сбой окружения — исключение (ретрай), попытка в checking; последняя попытка — failed: error', async () => {
    const { attempt } = await queuedAttempt();
    const analyze = vi.spyOn(processor(), 'analyze').mockRejectedValue(new Error('loader'));
    await expect(processor().check(attempt._id, 1)).rejects.toThrow('loader');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'checking',
      checkAttempts: 1,
    });
    expect(await processor().check(attempt._id, 1, { finalAttempt: true })).toBe('failed');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'failed',
      failure: 'error',
      checkAttempts: 2,
    });
    analyze.mockRestore();
  });

  it('таймаут потока — failed: timeout без ретрая; файл неправдоподобен — rejected: implausible', async () => {
    const { attempt } = await queuedAttempt();
    const analyze = vi
      .spyOn(processor(), 'analyze')
      .mockResolvedValueOnce({ ok: false, code: 'timeout' });
    expect(await processor().check(attempt._id, 1)).toBe('failed');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'failed',
      failure: 'timeout',
    });
    await h.worker.get(ResultsRecheck).requestRace(attempt.raceId, justAfter());
    analyze.mockResolvedValueOnce({ ok: false, code: 'implausible' });
    expect(await processor().check(attempt._id, 2)).toBe('rejected');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'rejected',
      reasons: ['implausible'],
      matched: false,
    });
    analyze.mockRestore();
  });

  it('негодный коридор (линия плотнее предела движка) — failed: corridor_invalid в настоящем потоке', async () => {
    const { routeId, auth, worker } = await entered();
    // зигзаг в одной ячейке сетки: развороты не прореживаются (подготовка — линия сверки маршрута до первого
    // чтения геометрии worker: готовый маршрут неизменяем и кэшируется в процессе)
    const zigzag = Array.from({ length: 60 }, (_, i): [number, number] => [
      27.559 + (i % 2) * 0.0015,
      53.9006 + i * 0.000005,
    ]);
    await routesDb(h).geometries.updateOne({ _id: routeId }, { $set: { matchLine: zigzag } });
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    await worker.intake();
    const [attempt] = await attempts();
    expect(await processor().check(attempt!._id, 1)).toBe('failed');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt!._id })).toMatchObject({
      failure: 'corridor_invalid',
    });
  });

  it('исходника нет: активность есть — failed: storage; активность удалена — withdrawn: activity_removed', async () => {
    const { attempt, ride } = await queuedAttempt();
    const upload = await tracks(h).uploads.findOne({ _id: ride.uploadId });
    await trackFileStore(h).delete(upload!.storageKey!);
    expect(await processor().check(attempt._id, 1)).toBe('failed');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      failure: 'storage',
    });
    await h.worker.get(ResultsRecheck).requestRace(attempt.raceId, justAfter());
    await tracks(h).activities.deleteOne({ _id: ride.activityId! });
    expect(await processor().check(attempt._id, 2)).toBe('withdrawn');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'withdrawn',
      withdrawReason: 'activity_removed',
    });
  });

  it('панель: counts.failed и attempts?status=failed с кодом и числом попыток (dead-letter)', async () => {
    const { attempt, raceId } = await queuedAttempt();
    vi.spyOn(processor(), 'analyze').mockResolvedValueOnce({ ok: false, code: 'timeout' });
    await processor().check(attempt._id, 1);
    const token = await panelSession(h, 'admin@example.by');
    const summary = PanelRaceResults.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${raceId}/results`)).body,
    );
    expect(summary.counts).toMatchObject({ failed: 1, attempts: { failed: 1 }, active: 1 });
    const page = PanelRaceAttemptPage.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${raceId}/attempts?status=failed`)).body,
    );
    expect(page.items).toMatchObject([
      { id: attempt._id, status: 'failed', failure: 'timeout', checkAttempts: 1, hidden: false },
    ]);
  });
});

describe('зависшие проверки (AC16)', () => {
  it('checking дольше 15 мин — новая ревизия и событие; после 3 перепостановок — failed: error', async () => {
    const { attempt } = await queuedAttempt();
    const repository = h.worker.get(ResultsRepository);
    const recheck = h.worker.get(ResultsRecheck);
    let revision = 1;
    for (let requeue = 1; requeue <= 3; requeue += 1) {
      await repository.claimAttempt(attempt._id, revision, h.clock.now());
      h.clock.advance(14 * MINUTE);
      expect(await recheck.requeueStuck()).toEqual({ requeued: 0, failed: 0 });
      h.clock.advance(2 * MINUTE);
      expect(await recheck.requeueStuck()).toEqual({ requeued: 1, failed: 0 });
      revision += 1;
      expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
        status: 'queued',
        checkRevision: revision,
        requeues: requeue,
      });
    }
    await repository.claimAttempt(attempt._id, revision, h.clock.now());
    h.clock.advance(16 * MINUTE);
    expect(await recheck.requeueStuck()).toEqual({ requeued: 0, failed: 1 });
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'failed',
      failure: 'error',
    });
    const events = await h.db
      .collection('outbox')
      .find({ type: 'results.attempt-check-requested' })
      .toArray();
    expect(events.map((event) => event.payload['checkRevision'])).toEqual([1, 2, 3, 4]);
  });
});

describe('регламент зависших — обход дальше живых задач (ревью pass 2)', () => {
  /**
   * 100 старых `queued` с живыми задачами впереди (по `_id`) и одна с потерянной задачей за ними: проход регламента не
   * застревает на пропущенных и перепоставляет последнюю. Отрицательное доказательство: без продолжения обхода
   * пакет из первых 100 занят пропущенными — потерянная задача не восстанавливается.
   */
  it('101 queued: первые 100 с живыми задачами пропущены, потерянная — новая ревизия', async () => {
    const { attempt } = await queuedAttempt();
    const base = (await resultsDb(h).attempts.findOne({ _id: attempt._id }))!;
    await resultsDb(h).attempts.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        ...base,
        _id: `01890a5d-ac96-774b-bcce-b3020990${String(i).padStart(4, '0')}`,
        activityId: `01890a5d-ac96-774b-bcce-b3020991${String(i).padStart(4, '0')}`,
        checkJobId: `live-${i}`,
        // старше потерянной: идут первыми в порядке обхода (самые давние)
        updatedAt: new Date(base.updatedAt.getTime() - (100 - i) * MINUTE),
      })),
    );
    h.clock.advance(3 * 60 * MINUTE);
    const result = await h.worker
      .get(ResultsRecheck)
      .requeueStuck({ jobPending: (jobId) => Promise.resolve(jobId.startsWith('live-')) });
    expect(result).toEqual({ requeued: 1, failed: 0 });
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'queued',
      checkRevision: 2,
    });
    expect(await resultsDb(h).attempts.countDocuments({ checkRevision: 1 })).toBe(100);
  });
});

describe('ожидание в очереди — не зависание (ревью L1)', () => {
  it('queued дольше 2 ч с живой задачей attempt-check — не переставляется; задачи нет — новая ревизия', async () => {
    const { attempt } = await queuedAttempt();
    const queued = await resultsDb(h).attempts.findOne({ _id: attempt._id });
    expect(queued?.checkJobId).toEqual(expect.any(String));
    const queue = h.worker.get<Queue>(getQueueToken(QUEUE.attemptCheck));
    await queue.add(
      'results.attempt-check-requested',
      { outboxEventId: queued!.checkJobId },
      {
        jobId: queued!.checkJobId!,
      },
    );
    const maintenance = h.worker.get(ResultsMaintenanceProcessor);
    const job = { name: RESULTS_REQUEUE_STUCK_JOB } as Job;
    h.clock.advance(3 * 60 * MINUTE);
    expect(await maintenance.process(job)).toEqual({ requeued: 0, failed: 0 });
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      checkRevision: 1,
    });
    await (await queue.getJob(queued!.checkJobId!))?.remove();
    expect(await maintenance.process(job)).toEqual({ requeued: 1, failed: 0 });
    const requeued = await resultsDb(h).attempts.findOne({ _id: attempt._id });
    expect(requeued).toMatchObject({ status: 'queued', checkRevision: 2, requeues: 1 });
    expect(requeued?.checkJobId).not.toBe(queued?.checkJobId);
  });
});

describe('лучший результат (AC17)', () => {
  /**
   * Две проверки попыток одной заявки параллельно: первая (быстрее) остановлена после записи вердикта до пересчёта
   * лучшего, вторая — целиком. Под `lockEntry` вторая конфликтует и видит первую — лучший = минимальное время.
   */
  it('параллельные вердикты — лучший по минимальному времени', async () => {
    const { auth, worker } = await entered();
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { scale: 0.9 }));
    await uploadRide(h, auth, rideGpx('clean.gpx', new Date(RIDE.getTime() + 60 * MINUTE)));
    await worker.intake();
    const [fast, slow] = await attempts();
    const repository = h.worker.get(ResultsRepository);
    const g = gate();
    const refresh = repository.refreshEntry.bind(repository);
    vi.spyOn(repository, 'refreshEntry').mockImplementationOnce(async (...args) => {
      await g.wait();
      return refresh(...args);
    });
    const lockSpy = vi.spyOn(repository, 'lockEntry');
    const first = processor().check(fast!._id, 1);
    await g.reached;
    const second = processor().check(slow!._id, 1);
    await untilBlocked(second, retried(lockSpy));
    g.open();
    expect(await Promise.all([first, second])).toEqual(['counted', 'counted']);
    const checked = new Map((await attempts()).map((a) => [a._id, a.segment!.elapsedSec]));
    expect(checked.get(fast!._id)).toBeLessThan(checked.get(slow!._id)!);
    const entry = await resultsDb(h).entries.findOne();
    expect(entry?.best).toMatchObject({ attemptId: fast!._id, elapsedSec: checked.get(fast!._id) });
    expect(entry?.summary).toMatchObject({ counted: 2, pending: 0 });
  });
});

describe('датчики и флаги попытки (race-results-07, AC7)', () => {
  /** Verified `m_u40` в новой гонке (`gender_age`): место — только с пульсом. */
  async function verifiedQueued(heartRate: number | undefined) {
    const race = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId, { gender: 'm', birthYear: 1995 });
    expect((await enterRace(h, r.auth, race.raceId, { tier: 'verified' })).status).toBe(201);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, AFTER_RIDE);
    const auth = await signIn(h, r.email);
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { heartRate, power: true }));
    await worker.intake();
    const [attempt] = await attempts();
    return { ...race, auth, attempt: attempt! };
  }

  it('с пульсом: sensors, flags, flagsVersion записаны; лучший — с местом; в «моём участии» флагов нет', async () => {
    const { attempt, raceId, auth } = await verifiedQueued(140);
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    const checked = await resultsDb(h).attempts.findOne({ _id: attempt._id });
    expect(checked).toMatchObject({
      sensors: { hr: true, power: true, source: 'samples' },
      flagsVersion: FLAGS_VERSION,
    });
    expect(Array.isArray(checked?.flags)).toBe(true);
    for (const flag of checked!.flags!) expect(Number.isInteger(flag.metric)).toBe(true);
    const entry = await resultsDb(h).entries.findOne();
    expect(entry?.best).toMatchObject({ attemptId: attempt._id, ranked: true });
    const view = await myEntry(h, auth, raceId);
    expect(view.result).toMatchObject({ status: 'provisional', place: 1, group: 'm_u40' });
    expect(JSON.stringify(view)).not.toMatch(/"(flags|sensors)"/);
  });

  it('без пульса: Verified — лучший без места (finisher, no_heart_rate); перепостановка сбрасывает поля', async () => {
    const { attempt, raceId, auth } = await verifiedQueued(undefined);
    expect(await processor().check(attempt._id, 1)).toBe('counted');
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      sensors: { hr: false, power: true, source: 'samples' },
      flags: [],
      flagsVersion: FLAGS_VERSION,
    });
    expect((await resultsDb(h).entries.findOne())?.best).toMatchObject({ ranked: false });
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'finisher',
      place: null,
      unranked: 'no_heart_rate',
    });
    await h.worker.get(ResultsRecheck).requestRace(raceId, justAfter());
    expect(await resultsDb(h).attempts.findOne({ _id: attempt._id })).toMatchObject({
      status: 'queued',
      sensors: null,
      flags: [],
      flagsVersion: null,
    });
  });
});

describe('импорт Garmin/Wahoo: пульс по признаку тренировки (race-results-07, решение автора 2026-10-27)', () => {
  /** Verified `m_u40`: заезд только импортом агрегатора (без рядов датчиков), проверка до итога. */
  async function verifiedImported(hasHeartRate: boolean) {
    const race = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId, { gender: 'm', birthYear: 1995 });
    expect((await enterRace(h, r.auth, race.raceId, { tier: 'verified' })).status).toBe(201);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, AFTER_RIDE);
    const auth = await signIn(h, r.email);
    const ride = await importRide(h, r.userId, rideGpx('clean.gpx', RIDE), {
      hasHeartRate,
      hasPower: false,
    });
    expect(ride.outcome).toBe('ready');
    await worker.drain();
    const [attempt] = await attempts();
    return { ...race, auth, attempt: attempt! };
  }

  it('hasHeartRate: true — sensors заявлены импортом, флагов нет; Verified-заявка получает место', async () => {
    const { attempt, raceId, auth } = await verifiedImported(true);
    expect(attempt).toMatchObject({
      status: 'counted',
      sensors: { hr: true, power: false, source: 'declared' },
      flags: [],
      flagsVersion: FLAGS_VERSION,
    });
    expect((await resultsDb(h).entries.findOne())?.best).toMatchObject({
      attemptId: attempt._id,
      ranked: true,
    });
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'provisional',
      place: 1,
      group: 'm_u40',
    });
    const token = await panelSession(h, 'admin@example.by');
    const res = await panelCall(h, token, 'GET', `${RACES}/${raceId}/attempts`);
    expect(res.status).toBe(200);
    // сырой ответ (не через `.default` схемы): источник пишет сервер
    expect((res.body as PanelRaceAttemptPage).items[0]?.sensors).toEqual({
      hr: true,
      power: false,
      source: 'declared',
    });
  });

  it('hasHeartRate: false — «без пульса»: лучший без места (finisher, no_heart_rate)', async () => {
    const { attempt, raceId, auth } = await verifiedImported(false);
    expect(attempt).toMatchObject({
      status: 'counted',
      sensors: { hr: false, power: false, source: 'declared' },
      flags: [],
    });
    expect((await resultsDb(h).entries.findOne())?.best).toMatchObject({ ranked: false });
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'finisher',
      place: null,
      unranked: 'no_heart_rate',
    });
  });
});
