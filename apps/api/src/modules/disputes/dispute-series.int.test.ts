import { rm } from 'node:fs/promises';

import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PanelDisputeSeries } from '@pokatim/contracts';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_DISPUTES, seedDispute } from '../../../test/disputes';
import { createHarness, type Harness } from '../../../test/harness';
import { panel, panelCall, panelSession } from '../../../test/panel';
import { staff } from '../../../test/races';
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
import { QUEUE } from '../../queues';
import { DisputeSeriesProcessor } from './dispute-series.processor';
import { DISPUTE_SERIES_POLICY } from './disputes.policy';

/**
 * Ряды пульса и мощности на разборе спора (race-results-06b: AC2–AC9): заезд эталона `clean.gpx` с пульсом и мощностью
 * в окне гонки стенда → засчитанная попытка цели → спор (вставкой) → GET рядов, задача `dispute-series` (процессор —
 * напрямую, поток разбора — настоящий), кэш Redis.
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
const HEART_RATE = 163;
const processor = () => h.worker.get(DisputeSeriesProcessor);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.disputeSeries));
const jobs = () => queue().getJobs(['waiting', 'delayed', 'active']);
const seriesUrl = (id: string) => `${ADMIN_DISPUTES}/${id}/series`;
const audits = () => panel(h).audit.find({ action: 'disputes.series_viewed' }).toArray();

async function series(token: string, id: string) {
  const res = await panelCall(h, token, 'GET', seriesUrl(id));
  expect(res.status).toBe(200);
  return PanelDisputeSeries.parse(res.body);
}

/** Засчитанный заезд цели (пульс, мощность 200 Вт) и открытый спор против него; сессия админа панели. */
async function disputedRide(options: { heartRate?: number; power?: boolean } = {}) {
  const { heartRate = HEART_RATE, power = true } = options;
  const race = await corridorRace(h);
  const target = await rider(h);
  expect((await enterRace(h, target.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  const auth = await signIn(h, target.email);
  const ride = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { heartRate, power }));
  await worker.drain();
  const entry = await resultsDb(h).entries.findOne({ userId: target.userId });
  const attempt = await resultsDb(h).attempts.findOne({ entryId: entry!._id });
  expect(attempt).toMatchObject({ status: 'counted', checkRevision: 1 });
  const dispute = await seedDispute(h, {
    raceId: race.raceId,
    targetEntryId: entry!._id,
    targetUserId: target.userId,
    category: 'speed_vs_heart_rate',
  });
  const token = await panelSession(h, 'admin@example.by');
  return { ...race, entry: entry!, attempt: attempt!, dispute, token, ride };
}

/** Единственная задача очереди → процессор напрямую. */
async function runJob(options: { finalAttempt?: boolean } = {}) {
  const [job] = await jobs();
  expect(job).toBeDefined();
  await job!.remove();
  return processor().build(job!.data, options);
}

describe('готовится → ряды (AC2–AC4)', () => {
  it('первый запрос ставит одну задачу, опрос — без новой; поток разбора строит ряды; журнал — один раз', async () => {
    const { dispute, token, attempt } = await disputedRide();
    expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
    expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({
      entryId: dispute.targetEntryId,
      attemptId: attempt._id,
      checkRevision: 1,
    });

    expect(await runJob()).toBe('ready');
    const ready = await series(token, dispute._id);
    if (ready.state !== 'ready') throw new Error(`ожидались ряды: ${ready.state}`);
    const { series: data } = ready;
    expect(data.distanceM.length).toBeGreaterThan(100);
    expect(data.distanceM.length).toBeLessThanOrEqual(400);
    expect(Math.abs(data.segmentDistanceM - attempt.segment!.distanceM)).toBeLessThan(100);
    expect(data.heartRate).toHaveLength(data.distanceM.length);
    expect(new Set(data.heartRate!.filter((v) => v !== null))).toEqual(new Set([HEART_RATE]));
    expect(new Set(data.power!.filter((v) => v !== null))).toEqual(new Set([200]));
    expect(data.speedKmh.some((v) => v !== null && v > 0)).toBe(true);
    expect(data.summary).toMatchObject({
      avgHeartRate: HEART_RATE,
      maxHeartRate: HEART_RATE,
      avgPower: 200,
      maxPower: 200,
    });
    expect(await jobs()).toHaveLength(0);

    // журнал доступа — один раз на (сотрудник, спор) за час, без значений
    const viewed = await audits();
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({
      subject: { kind: 'race', id: dispute.raceId },
      details: { disputeId: dispute._id, entryId: dispute.targetEntryId },
      reason: null,
    });
  });

  it('биометрия не в MongoDB и не в логах: только кэш Redis с TTL (AC4, AC9)', async () => {
    const { dispute, token, attempt } = await disputedRide();
    const logs: string[] = [];
    const spy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => void logs.push(String(message)));
    try {
      await series(token, dispute._id);
      await runJob();
      await series(token, dispute._id);
    } finally {
      spy.mockRestore();
    }
    expect(logs.some((line) => line.includes(attempt._id))).toBe(true);
    for (const line of logs) {
      expect(line.replace(/ in \d+ ms/, '')).not.toMatch(new RegExp(`\\b(${HEART_RATE}|200)\\b`));
    }

    const ttl = await h.redis.ttl(`dispute-series:ready:${attempt._id}:1`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(DISPUTE_SERIES_POLICY.readyTtlSec);

    for (const name of (await h.db.listCollections().toArray()).map((c) => c.name)) {
      const docs = await h.db.collection(name).find().toArray();
      expect(JSON.stringify(docs)).not.toMatch(/heartRate"\s*:\s*\[|speedKmh/);
    }
  });

  it('импорт без датчиков — ряд скорости, пульс и мощность null', async () => {
    const { dispute, token } = await disputedRide({ heartRate: 0, power: false });
    await series(token, dispute._id);
    expect(await runJob()).toBe('ready');
    const ready = await series(token, dispute._id);
    expect(ready).toMatchObject({
      state: 'ready',
      series: { heartRate: null, power: null, summary: { avgHeartRate: null, avgPower: null } },
    });
  });
});

describe('рядов нет (AC5)', () => {
  it('у цели нет засчитанного результата — no_result без задачи', async () => {
    const { raceId } = await corridorRace(h);
    const target = await rider(h);
    await enterRace(h, target.auth, raceId);
    const entry = await resultsDb(h).entries.findOne();
    const dispute = await seedDispute(h, { raceId, targetEntryId: entry!._id });
    const token = await panelSession(h, 'admin@example.by');
    expect(await series(token, dispute._id)).toEqual({ state: 'unavailable', reason: 'no_result' });
    expect(await jobs()).toHaveLength(0);
  });

  it('исходника нет — no_source; повтор запроса задачу не ставит, пока жив отказ', async () => {
    const { dispute, token } = await disputedRide();
    await series(token, dispute._id);
    await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
    expect(await runJob()).toBe('no_source');
    expect(await series(token, dispute._id)).toEqual({ state: 'unavailable', reason: 'no_source' });
    expect(await jobs()).toHaveLength(0);
  });

  it('отказ потока — failed; сбой окружения — ретрай, на последней попытке — failed', async () => {
    const { dispute, token, attempt } = await disputedRide();
    await series(token, dispute._id);
    const analyze = vi.spyOn(processor(), 'analyze');
    try {
      analyze.mockResolvedValueOnce({ ok: false, code: 'timeout' });
      expect(await runJob()).toBe('failed');
      expect(await series(token, dispute._id)).toEqual({ state: 'unavailable', reason: 'failed' });

      // отказ истёк — новая постановка; сбой окружения не на последней попытке — исключение, кэш пуст
      await h.redis.del(`dispute-series:failed:${attempt._id}:1`);
      expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
      const [job] = await jobs();
      analyze.mockRejectedValue(new Error('parser module failed to load'));
      await expect(processor().build(job!.data)).rejects.toThrow('parser module');
      expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
      expect(await processor().build(job!.data, { finalAttempt: true })).toBe('failed');
      expect(await series(token, dispute._id)).toEqual({ state: 'unavailable', reason: 'failed' });
    } finally {
      analyze.mockRestore();
    }
  });
});

describe('перепроверка (AC6)', () => {
  it('новая ревизия — старые ряды не отдаются, задача старой ревизии — skipped', async () => {
    const { dispute, token, attempt } = await disputedRide();
    const bump = () =>
      resultsDb(h).attempts.updateOne({ _id: attempt._id }, { $inc: { checkRevision: 1 } });
    await series(token, dispute._id);
    const [first] = await jobs();
    await first!.remove();
    expect(await processor().build(first!.data)).toBe('ready');
    expect((await series(token, dispute._id)).state).toBe('ready');

    // ревизия 2: ряды ревизии 1 не отдаются, ставится новая задача
    await bump();
    expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
    const [second] = await jobs();
    await second!.remove();
    expect(second!.data).toMatchObject({ checkRevision: 2 });

    // ревизия 3 до выполнения задачи ревизии 2 — та не пишет кэш
    await bump();
    expect(await processor().build(second!.data)).toBe('skipped');
    expect(await h.redis.exists(`dispute-series:ready:${attempt._id}:2`)).toBe(0);
    expect(await series(token, dispute._id)).toEqual({ state: 'preparing' });
  });
});

describe('доступ и лимит (AC7, AC8)', () => {
  it('без сессии — 401; organizer без disputes.read — 403; moderator — 200; неизвестный спор — 404', async () => {
    const { dispute } = await disputedRide();
    expect((await panelCall(h, undefined, 'GET', seriesUrl(dispute._id))).status).toBe(401);
    const organizer = await staff(h, 'org@example.by', 'organizer');
    expect((await panelCall(h, organizer.token, 'GET', seriesUrl(dispute._id))).status).toBe(403);
    const moderator = await staff(h, 'mod@example.by', 'moderator');
    expect((await panelCall(h, moderator.token, 'GET', seriesUrl(dispute._id))).status).toBe(200);
    const unknown = await panelCall(
      h,
      moderator.token,
      'GET',
      seriesUrl('01890a5d-ac96-774b-bcce-b302099a8057'),
    );
    expect([unknown.status, unknown.body]).toMatchObject([404, { code: 'DISPUTE_NOT_FOUND' }]);
    expect((await panelCall(h, moderator.token, 'GET', seriesUrl('not-a-uuid'))).status).toBe(400);
  });

  it('лимит постановок исчерпан — 429, ключ постановки снят, задачи нет', async () => {
    const { dispute, token, admin, attempt } = await disputedRide();
    const limiter = h.app.get(RateLimiter);
    for (let i = 0; i < DISPUTE_SERIES_POLICY.staffLimit.limit; i += 1) {
      await limiter.consume(
        `dispute-series-user:${admin.userId}`,
        DISPUTE_SERIES_POLICY.staffLimit,
        h.clock.now(),
      );
    }
    const res = await panelCall(h, token, 'GET', seriesUrl(dispute._id));
    expect([res.status, res.body]).toMatchObject([429, { code: 'RATE_LIMITED' }]);
    expect(await h.redis.exists(`dispute-series:pending:${attempt._id}:1`)).toBe(0);
    expect(await jobs()).toHaveLength(0);
  });
});
