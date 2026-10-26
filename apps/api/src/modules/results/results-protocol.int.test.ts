import { rm } from 'node:fs/promises';

import { PanelRace, PanelRaceAttempt, PanelRaceResults } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, gate, outboxEvents, retried, untilBlocked } from '../../../test/identity';
import { panel, panelCall, panelSession } from '../../../test/panel';
import { publishedRace, RACES, racesDb, racesRepository, staff } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  panelResults,
  protocolAction,
  protocolRace,
  REASON,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  signIn,
  travelTo,
  UPLOAD_CLOSES,
  uploadRide,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { parsedUpload, uploadTrack } from '../../../test/tracks';
import { AttemptCheckProcessor } from './attempt-check.processor';
import { ResultsRepository } from './results.repository';

/**
 * Протокол гонки (race-results-05: AC1–AC6, AC11): сводка и чек-лист, исключение и возврат трека, публикация,
 * D-19, приём после публикации, замок результатов гонки. Заезд эталона — в окне гонки стенда (25.10 09:00 Минска).
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
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const RIDE = new Date('2026-10-25T06:00:00Z');
const AFTER_RIDE = new Date('2026-10-25T08:00:00Z');
const processor = () => h.worker.get(AttemptCheckProcessor);
const attempts = () => resultsDb(h).attempts.find().sort({ _id: 1 }).toArray();
const checklist = (summary: PanelRaceResults) =>
  Object.fromEntries(summary.publish.checklist.map((row) => [row.code, row.count]));
const blockReason = (body: unknown) => (body as { details?: { reason?: string } }).details?.reason;
const auditOf = (action: string) =>
  panel(h)
    .audit.find({ action: action as never })
    .toArray();

/** Райдер с заявкой и заездом эталона: попытка проверена (засчитана). */
async function countedRide(name = 'clean.gpx') {
  const race = await corridorRace(h);
  const r = await rider(h);
  expect((await enterRace(h, r.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  const auth = await signIn(h, r.email);
  const ride = await uploadRide(h, auth, rideGpx(name, RIDE));
  await worker.drain();
  const [attempt] = await attempts();
  return { ...race, ...r, auth, ride, worker, attempt: attempt! };
}

describe('сводка и чек-лист (AC1)', () => {
  it('фаза, срок загрузки, протокол null, 5 строк чек-листа — каждая не ноль по своей причине', async () => {
    const { raceId, auth, worker, attempt } = await countedRide();
    expect(attempt.status).toBe('counted');
    // второй заезд: попытка с финальным провалом проверки (dead-letter)
    await uploadRide(h, auth, rideGpx('wobble-3pct.gpx', new Date('2026-10-25T07:00:00Z')));
    await worker.intake();
    const second = (await attempts()).find((item) => item._id !== attempt._id)!;
    vi.spyOn(processor(), 'analyze').mockResolvedValueOnce({ ok: false, code: 'timeout' });
    expect(await processor().check(second._id, 1)).toBe('failed');
    // третий файл не разобран — «необработанные треки»
    parsedUpload(
      await uploadTrack(h, auth, rideGpx('clean.gpx', new Date('2026-10-26T06:00:00Z'))),
    );

    let token = await panelSession(h, 'admin@example.by');
    let summary = await panelResults(h, token, raceId);
    expect(summary).toMatchObject({
      phase: 'open',
      uploadClosesAt: UPLOAD_CLOSES.toISOString(),
      protocol: null,
      recheck: null,
      publish: { canPublish: false, blockedBy: null },
    });
    expect(summary.publish.checklist.map((row) => row.code)).toEqual([
      'open_disputes',
      'unprocessed_tracks',
      'checks_queued',
      'checks_failed',
      'window_open',
    ]);
    expect(checklist(summary)).toEqual({
      open_disputes: 0,
      unprocessed_tracks: 1,
      checks_queued: 0,
      checks_failed: 1,
      window_open: 1,
    });
    expect(summary.counts.attempts).toMatchObject({ counted: 1, failed: 1, excluded: 0 });

    // перепроверка: вердикты старше запуска — незавершённые проверки, пока worker их не перепоставит (RC-1)
    h.clock.advance(1000);
    const recheck = await protocolAction(h, token, raceId, '/results/recheck');
    expect(recheck.status).toBe(200);
    summary = PanelRaceResults.parse(recheck.body);
    expect(checklist(summary).checks_queued).toBe(2);
    expect(summary.recheck).toEqual({ startedAt: h.clock.now().toISOString(), pending: 2 });
    await worker.intake();
    summary = await panelResults(h, token, raceId);
    expect(checklist(summary)).toMatchObject({ checks_queued: 2, checks_failed: 0 });
    expect(summary.counts.attempts).toMatchObject({ queued: 2 });
    await worker.drain();
    summary = await panelResults(h, token, raceId);
    expect(checklist(summary)).toMatchObject({ checks_queued: 0, checks_failed: 0 });
    expect(summary.recheck?.pending).toBe(0);

    // срок загрузки истёк; необработанный файл остаётся строкой чек-листа
    travelTo(h, UPLOAD_CLOSES);
    token = await panelSession(h, 'admin@example.by');
    summary = await panelResults(h, token, raceId);
    expect(summary.phase).toBe('closed');
    expect(checklist(summary)).toMatchObject({ window_open: 0, unprocessed_tracks: 1 });
    expect(summary.publish.canPublish).toBe(false);
  });

  it('черновик — 404; отменённая — blockedBy cancelled; без коридора — no_corridor', async () => {
    const { admin, raceId, version } = await corridorRace(h);
    const anons = await publishedRace(h, admin.token, { title: 'Анонс' });
    expect((await panelResults(h, admin.token, anons.id)).publish.blockedBy).toBe('no_corridor');
    const cancel = await panelCall(h, admin.token, 'POST', `${RACES}/${raceId}/cancel`, {
      version,
      reason: 'weather',
    });
    expect(cancel.status).toBe(200);
    expect(await panelResults(h, admin.token, raceId)).toMatchObject({
      phase: 'cancelled',
      publish: { blockedBy: 'cancelled', canPublish: false },
    });
    const exclude = await protocolAction(h, admin.token, raceId, '/results/recheck');
    expect([exclude.status, blockReason(exclude.body)]).toEqual([409, 'race_cancelled']);
  });
});

describe('исключение и возврат трека (AC2, AC3, D-24)', () => {
  it('исключение лучшей: excluded, запись отзыва, журнал с причиной, лучший снят; возврат — новая ревизия и событие', async () => {
    const { raceId, attempt } = await countedRide();
    const token = await panelSession(h, 'admin@example.by');
    expect((await resultsDb(h).entries.findOne())?.best?.attemptId).toBe(attempt._id);

    const excluded = await protocolAction(h, token, raceId, `/attempts/${attempt._id}/exclude`, {
      reason: 'Чужой трек',
    });
    expect(excluded.status).toBe(200);
    expect(PanelRaceAttempt.parse(excluded.body)).toMatchObject({
      id: attempt._id,
      status: 'excluded',
      checkRevision: 1,
      segment: { elapsedSec: attempt.segment!.elapsedSec },
      review: { kind: 'excluded', reason: 'Чужой трек' },
    });
    const entry = await resultsDb(h).entries.findOne();
    expect(entry?.best).toBeNull();
    expect(entry?.summary).toMatchObject({ counted: 0, excluded: 1 });
    expect(await resultsDb(h).reviews.find().toArray()).toMatchObject([
      { attemptId: attempt._id, entryId: attempt.entryId, kind: 'excluded', reason: 'Чужой трек' },
    ]);
    expect(await auditOf('results.attempt_excluded')).toMatchObject([
      {
        reason: 'Чужой трек',
        subject: { kind: 'race', id: raceId },
        details: { attemptId: attempt._id, entryId: attempt.entryId },
      },
    ]);
    // повтор — статус уже не подходит
    const again = await protocolAction(h, token, raceId, `/attempts/${attempt._id}/exclude`);
    expect([again.status, blockReason(again.body)]).toEqual([409, 'attempt_state']);
    // приём не оживляет исключённую
    await resultsWorker(h).intake();
    expect((await attempts())[0]?.status).toBe('excluded');

    const restored = await protocolAction(h, token, raceId, `/attempts/${attempt._id}/restore`);
    expect(restored.status).toBe(200);
    expect(PanelRaceAttempt.parse(restored.body)).toMatchObject({
      status: 'queued',
      checkRevision: 2,
      segment: null,
      review: { kind: 'restored' },
    });
    const checks = (await outboxEvents(h)).filter(
      (event) => event.type === 'results.attempt-check-requested',
    );
    expect(checks.at(-1)?.payload).toEqual({ attemptId: attempt._id, checkRevision: 2 });
    expect(await processor().check(attempt._id, 1)).toBe('skipped');
    expect(await processor().check(attempt._id, 2)).toBe('counted');
    expect((await resultsDb(h).entries.findOne())?.best?.attemptId).toBe(attempt._id);
    expect(await auditOf('results.attempt_restored')).toHaveLength(1);
    const restoreAgain = await protocolAction(h, token, raceId, `/attempts/${attempt._id}/restore`);
    expect([restoreAgain.status, blockReason(restoreAgain.body)]).toEqual([409, 'attempt_state']);
  });

  it('исключение dead-letter снимает строку checks_failed; поздний вердикт исключённой — no-op', async () => {
    const { raceId, attempt, auth, worker } = await countedRide();
    await uploadRide(h, auth, rideGpx('wobble-3pct.gpx', new Date('2026-10-25T07:00:00Z')));
    await worker.intake();
    const second = (await attempts()).find((item) => item._id !== attempt._id)!;
    vi.spyOn(processor(), 'analyze').mockResolvedValueOnce({ ok: false, code: 'timeout' });
    await processor().check(second._id, 1);
    const token = await panelSession(h, 'admin@example.by');
    expect(checklist(await panelResults(h, token, raceId)).checks_failed).toBe(1);
    expect((await protocolAction(h, token, raceId, `/attempts/${second._id}/exclude`)).status).toBe(
      200,
    );
    const summary = await panelResults(h, token, raceId);
    expect(checklist(summary).checks_failed).toBe(0);
    expect(summary.counts.attempts).toMatchObject({ failed: 0, excluded: 1 });

    // исключённая в очереди: поздняя задача её ревизии ничего не пишет
    const third = await uploadRide(
      h,
      auth,
      rideGpx('clean.gpx', new Date('2026-10-25T05:00:00Z'), { scale: 1.1 }),
    );
    await worker.intake();
    const queued = (await attempts()).find((item) => item.activityId === third.activityId)!;
    expect(queued.status).toBe('queued');
    await protocolAction(h, token, raceId, `/attempts/${queued._id}/exclude`);
    expect(await processor().check(queued._id, 1)).toBe('skipped');
    expect(await resultsDb(h).attempts.findOne({ _id: queued._id })).toMatchObject({
      status: 'excluded',
      segment: null,
    });
  });
});

describe('исключение действует на поездку (ревью pass 1)', () => {
  it('дубль той же поездки (новая основная) не создаёт попытку в обход исключения; явный выбор — тоже', async () => {
    const { raceId, attempt, auth, worker, ride } = await countedRide();
    const token = await panelSession(h, 'admin@example.by');
    expect(
      (await protocolAction(h, token, raceId, `/attempts/${attempt._id}/exclude`)).status,
    ).toBe(200);
    const powered = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE, { power: true }));
    await worker.drain();
    expect((await attempts()).map((item) => [item.activityId, item.status])).toEqual([
      [ride.activityId, 'excluded'],
    ]);
    const explicit = await call(
      h,
      'POST',
      `/v1/races/${raceId}/attempts`,
      { activityId: powered.activityId },
      auth,
    );
    expect(explicit.status).toBe(200);
    expect(await attempts()).toHaveLength(1);
    expect((await resultsDb(h).entries.findOne())?.best).toBeNull();
  });
});

describe('права и состояние (AC4)', () => {
  it('без results.manage — 403; чужая гонка организатора — 404; попытка другой гонки — 404; после публикации — 409', async () => {
    const { raceId, attempt } = await countedRide();
    const moderator = await staff(h, 'mod@example.by', 'moderator');
    const org = await staff(h, 'org@example.by', 'organizer');
    const path = `/attempts/${attempt._id}/exclude`;
    expect((await protocolAction(h, moderator.token, raceId, path)).status).toBe(403);
    expect((await protocolAction(h, org.token, raceId, path)).status).toBe(404);
    expect((await protocolAction(h, org.token, raceId, '/protocol')).status).toBe(404);
    const token = await panelSession(h, 'admin@example.by');
    const other = await publishedRace(h, token, { title: 'Другая гонка' });
    expect(
      (await protocolAction(h, token, other.id, `/attempts/${attempt._id}/exclude`)).status,
    ).toBe(404);
    expect((await protocolAction(h, token, raceId, path, { reason: 'ab' })).status).toBe(400);
    expect(
      (await protocolAction(h, token, raceId, path, { ...REASON, status: 'excluded' })).status,
    ).toBe(400);
    // организатор — results.manage, но без results.revise: гард отказывает до видимости гонки
    expect(
      (
        await protocolAction(h, org.token, raceId, '/protocol/disqualify', {
          entryId: attempt.entryId,
          ...REASON,
        })
      ).status,
    ).toBe(403);

    travelTo(h, UPLOAD_CLOSES);
    const fresh = await panelSession(h, 'admin@example.by');
    expect((await protocolAction(h, fresh, raceId, '/protocol')).status).toBe(200);
    for (const action of ['exclude', 'restore']) {
      const res = await protocolAction(h, fresh, raceId, `/attempts/${attempt._id}/${action}`);
      expect([res.status, blockReason(res.body)]).toEqual([409, 'protocol_published']);
    }
    const recheck = await protocolAction(h, fresh, raceId, '/results/recheck');
    expect([recheck.status, blockReason(recheck.body)]).toEqual([409, 'protocol_published']);
  });
});

describe('публикация (AC5, RC-2)', () => {
  it('чек-лист не пуст — 409 RESULTS_PUBLISH_BLOCKED с чек-листом; пуст — final, «1, =2, =2, 4», событие, журнал; повтор — published', async () => {
    const { raceId, riders } = await protocolRace(h, [3700, 3600, 3800, 3700, null]);
    await resultsDb(h).attempts.insertOne({
      ...fakeAttempt(raceId, riders[4]!.entryId, riders[4]!.userId),
      status: 'queued',
    });
    const token = await panelSession(h, 'admin@example.by');
    const refused = await protocolAction(h, token, raceId, '/protocol');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'RESULTS_PUBLISH_BLOCKED',
      details: { blockedBy: null },
    });
    expect(
      (refused.body as { details: { checklist: { code: string; count: number }[] } }).details
        .checklist,
    ).toContainEqual({ code: 'checks_queued', count: 1 });
    expect(await resultsDb(h).protocolRows.countDocuments()).toBe(0);
    await resultsDb(h).attempts.deleteMany({ raceId });

    const res = await protocolAction(h, token, raceId, '/protocol', { reason: 'Итоги' });
    expect(res.status).toBe(200);
    expect(PanelRaceResults.parse(res.body)).toMatchObject({
      phase: 'final',
      protocol: { revision: 1, ranked: 4, disqualified: 0, recheckPending: false },
      publish: { canPublish: false, blockedBy: 'published' },
    });
    const race = await racesDb(h).races.findOne({ _id: raceId });
    expect(race?.protocolPublishedAt).toEqual(h.clock.now());
    const rows = await resultsDb(h).protocolRows.find({ raceId }).sort({ order: 1 }).toArray();
    expect(rows.map((row) => [row.entryId, row.place, row.tied, row.status, row.revision])).toEqual(
      [
        [riders[1]!.entryId, 1, false, 'final', 1],
        [riders[0]!.entryId, 2, true, 'final', 1],
        [riders[3]!.entryId, 2, true, 'final', 1],
        [riders[2]!.entryId, 4, false, 'final', 1],
      ],
    );
    expect(await resultsDb(h).recalculations.find().toArray()).toMatchObject([
      { raceId, kind: 'published', revision: 1, reason: 'Итоги', entryId: null },
    ]);
    // событие без маршрута: лежит неопубликованным до слайса 08 (RC-4)
    const published = (await outboxEvents(h)).filter(
      (event) => event.type === 'results.protocol-published',
    );
    expect(published).toMatchObject([{ payload: { raceId, revision: 1 }, publishedAt: null }]);
    expect(await auditOf('results.protocol_published')).toMatchObject([
      { reason: 'Итоги', details: { revision: 1 }, subject: { id: raceId } },
    ]);
    const again = await protocolAction(h, token, raceId, '/protocol');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'RESULTS_PUBLISH_BLOCKED',
      details: { blockedBy: 'published' },
    });
  });

  it('пустой протокол (нет засчитанных) — ревизия 1 в журнале пересчётов, строк нет', async () => {
    const { raceId, token } = await protocolRace(h, [null]);
    const res = await protocolAction(h, token, raceId, '/protocol');
    expect(res.status).toBe(200);
    expect(PanelRaceResults.parse(res.body).protocol).toMatchObject({ revision: 1, ranked: 0 });
    expect(await resultsDb(h).protocolRows.countDocuments()).toBe(0);
    expect(await resultsDb(h).recalculations.countDocuments({ revision: 1 })).toBe(1);
  });

  it('приём после публикации новых попыток не создаёт', async () => {
    const race = await corridorRace(h);
    const r = await rider(h);
    await enterRace(h, r.auth, race.raceId);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, AFTER_RIDE);
    const auth = await signIn(h, r.email);
    await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    expect((await protocolAction(h, token, race.raceId, '/protocol')).status).toBe(200);
    await worker.drain();
    expect(await attempts()).toEqual([]);
  });
});

describe('D-19 и замок результатов (AC6, AC11)', () => {
  it('гонка final: editable без отмены, причина results_final; отмена — 409', async () => {
    const { raceId, token } = await protocolRace(h, [3600]);
    await protocolAction(h, token, raceId, '/protocol');
    const race = PanelRace.parse((await panelCall(h, token, 'GET', `${RACES}/${raceId}`)).body);
    expect(race).toMatchObject({ phase: 'final', editable: { canCancel: false } });
    expect(race.editable.reasons).toContain('results_final');
    expect(race.editable.reasons).not.toContain('window_closed');
    const cancel = await panelCall(h, token, 'POST', `${RACES}/${raceId}/cancel`, {
      version: race.version,
      reason: 'weather',
    });
    expect(cancel.status).toBe(409);
  });

  it('отмена ↔ публикация: отмена упирается в замок публикации и после коммита — 409; гонка final', async () => {
    const { raceId, token } = await protocolRace(h, [3600]);
    const version = PanelRace.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${raceId}`)).body,
    ).version;
    const repository = h.app.get(ResultsRepository, { strict: false });
    const g = gate();
    const pendingChecks = repository.pendingChecks.bind(repository);
    vi.spyOn(repository, 'pendingChecks').mockImplementationOnce(async (...args) => {
      await g.wait();
      return pendingChecks(...args);
    });
    const updateSpy = vi.spyOn(racesRepository(h), 'updateRace');
    const publishing = protocolAction(h, token, raceId, '/protocol');
    await g.reached;
    const cancelling = panelCall(h, token, 'POST', `${RACES}/${raceId}/cancel`, {
      version,
      reason: 'weather',
    });
    await untilBlocked(cancelling, retried(updateSpy));
    g.open();
    const [published, cancelled] = await Promise.all([publishing, cancelling]);
    expect(published.status).toBe(200);
    expect(cancelled.status).toBe(409);
    expect(await racesDb(h).races.findOne({ _id: raceId })).toMatchObject({
      status: 'published',
      protocolPublishedAt: h.clock.now(),
    });
  });

  /**
   * AC11 (RC-3): исключение лучшей попытки ↔ публикация. С замком исключение упирается в незакоммиченную запись
   * публикации в документ гонки и повторяется; после коммита — 409 protocol_published, снимок согласован с попыткой.
   * Отрицательное доказательство (task.md §12): `lockResults` подменён чтением — обе 200, в снимке исключённая попытка.
   */
  it('исключение ↔ публикация: исключение повторяется на замке и получает protocol_published', async () => {
    const { raceId, attempt } = await countedRide();
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    const repository = h.app.get(ResultsRepository, { strict: false });
    const g = gate();
    const pendingChecks = repository.pendingChecks.bind(repository);
    vi.spyOn(repository, 'pendingChecks').mockImplementationOnce(async (...args) => {
      await g.wait();
      return pendingChecks(...args);
    });
    const lockSpy = vi.spyOn(racesRepository(h), 'lockResults');
    const publishing = protocolAction(h, token, raceId, '/protocol');
    await g.reached;
    const excluding = protocolAction(h, token, raceId, `/attempts/${attempt._id}/exclude`);
    // публикация — 1 вызов замка; исключение — повтор после конфликта записи
    await untilBlocked(excluding, () => Promise.resolve(lockSpy.mock.calls.length >= 3));
    g.open();
    const [published, excluded] = await Promise.all([publishing, excluding]);
    expect(published.status).toBe(200);
    expect([excluded.status, blockReason(excluded.body)]).toEqual([409, 'protocol_published']);
    const rows = await resultsDb(h).protocolRows.find({ raceId }).toArray();
    expect(rows.map((row) => row.attemptId)).toEqual([attempt._id]);
    expect((await resultsDb(h).attempts.findOne({ _id: attempt._id }))?.status).toBe('counted');
  });
});

/** Попытка напрямую в БД (подготовка состояния чек-листа). */
function fakeAttempt(raceId: string, entryId: string, userId: string) {
  const now = h.clock.now();
  return {
    _id: uuidv7(),
    raceId,
    entryId,
    userId,
    activityId: uuidv7(),
    uploadId: uuidv7(),
    activity: { startedAt: now, source: 'upload' as const, elapsedSec: 1, distanceM: 1 },
    origin: 'auto' as const,
    status: 'queued' as const,
    matched: null,
    reasons: [],
    failure: null,
    withdrawReason: null,
    segment: null,
    touchedCorridor: null,
    candidates: null,
    diagnostics: null,
    engineVersion: null,
    corridor: { routeId: uuidv7(), widthM: 50 },
    checkRevision: 1,
    checkAttempts: 0,
    requeues: 0,
    checkJobId: null,
    createdAt: now,
    updatedAt: now,
    checkedAt: null,
  };
}
