import { rm } from 'node:fs/promises';

import { PanelProtocolRecalculations, PanelRaceResults } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { outboxEvents } from '../../../test/identity';
import { panel, panelCall, panelSession } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  protocolAction,
  protocolRace,
  raceAdminUrl,
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
import { AttemptCheckProcessor } from './attempt-check.processor';
import { ResultsRecheck } from './results-recheck';

/**
 * Экстренный пересчёт после публикации (race-results-05: AC7, AC8, RC-1…RC-3): DQ и отмена DQ, перепроверка в worker
 * и «Применить пересчёт», журнал ревизий.
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

const blockReason = (body: unknown) => (body as { details?: { reason?: string } }).details?.reason;
const rowsOf = async (raceId: string, revision: number) =>
  (await resultsDb(h).protocolRows.find({ raceId, revision }).sort({ order: 1 }).toArray()).map(
    (row) => [row.entryId, row.place, row.tied, row.status],
  );
const revisedEvents = async () =>
  (await outboxEvents(h))
    .filter((event) => event.type === 'results.result-revised')
    .map((event) => [event.payload, event.publishedAt]);

/** Опубликованный протокол «3600, 3700, 3800». */
async function published() {
  const race = await protocolRace(h, [3600, 3700, 3800]);
  expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
  const [a, b, c] = race.riders.map((r) => r.entryId) as [string, string, string];
  return { ...race, a, b, c };
}

describe('DQ и отмена DQ (AC7, D-27, D-28)', () => {
  it('DQ: новая ревизия, строка dq в конце без места, места пересчитаны (revised); отмена — место вернулось', async () => {
    const { raceId, token, a, b, c } = await published();
    const dq = await protocolAction(h, token, raceId, '/protocol/disqualify', {
      entryId: a,
      reason: 'Срезка маршрута',
    });
    expect(dq.status).toBe(200);
    expect(PanelRaceResults.parse(dq.body).protocol).toMatchObject({
      revision: 2,
      ranked: 2,
      disqualified: 1,
    });
    expect(await rowsOf(raceId, 2)).toEqual([
      [b, 1, false, 'revised'],
      [c, 2, false, 'revised'],
      [a, null, false, 'dq'],
    ]);
    // ревизия 1 не изменилась
    expect(await rowsOf(raceId, 1)).toEqual([
      [a, 1, false, 'final'],
      [b, 2, false, 'final'],
      [c, 3, false, 'final'],
    ]);
    const again = await protocolAction(h, token, raceId, '/protocol/disqualify', {
      entryId: a,
      reason: 'Повтор',
    });
    expect([again.status, blockReason(again.body)]).toEqual([409, 'row_state']);
    const unknown = await protocolAction(h, token, raceId, '/protocol/disqualify', {
      entryId: uuidv7(),
      reason: 'Нет такого',
    });
    expect([unknown.status, blockReason(unknown.body)]).toEqual([409, 'row_state']);

    const revoked = await protocolAction(h, token, raceId, '/protocol/revoke-disqualification', {
      entryId: a,
      reason: 'Апелляция',
    });
    expect(revoked.status).toBe(200);
    expect(await rowsOf(raceId, 3)).toEqual([
      [a, 1, false, 'revised'],
      [b, 2, false, 'revised'],
      [c, 3, false, 'revised'],
    ]);
    const revokeAgain = await protocolAction(
      h,
      token,
      raceId,
      '/protocol/revoke-disqualification',
      {
        entryId: a,
        reason: 'Повтор',
      },
    );
    expect([revokeAgain.status, blockReason(revokeAgain.body)]).toEqual([409, 'row_state']);

    expect(
      (await resultsDb(h).recalculations.find({ raceId }).sort({ revision: 1 }).toArray()).map(
        (doc) => [doc.kind, doc.revision, doc.entryId],
      ),
    ).toEqual([
      ['published', 1, null],
      ['disqualified', 2, a],
      ['disqualification_revoked', 3, a],
    ]);
    expect(await revisedEvents()).toEqual([
      [{ raceId, revision: 2, kind: 'disqualified', entryId: a }, null],
      [{ raceId, revision: 3, kind: 'disqualification_revoked', entryId: a }, null],
    ]);
    expect(
      (
        await panel(h)
          .audit.find({
            action: { $in: ['results.result_disqualified', 'results.disqualification_revoked'] },
          })
          .sort({ 'details.revision': 1 })
          .toArray()
      ).map((doc) => [doc.action, doc.reason, doc.details]),
    ).toEqual([
      ['results.result_disqualified', 'Срезка маршрута', { revision: 2, entryId: a }],
      ['results.disqualification_revoked', 'Апелляция', { revision: 3, entryId: a }],
    ]);
    const history = PanelProtocolRecalculations.parse(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/protocol/recalculations'))).body,
    );
    expect(history.items.map((item) => item.kind)).toHaveLength(3);
    expect(history.items[0]?.actor.displayName).toBe('Сотрудник admin');
  });

  it('без results.revise — 403; до публикации — 409 protocol_not_published', async () => {
    const { raceId, token, riders } = await protocolRace(h, [3600]);
    const org = await staff(h, 'org@example.by', 'organizer');
    const body = { entryId: riders[0]!.entryId, reason: 'Срезка' };
    expect((await protocolAction(h, org.token, raceId, '/protocol/disqualify', body)).status).toBe(
      403,
    );
    for (const path of [
      '/protocol/disqualify',
      '/protocol/revoke-disqualification',
      '/protocol/recheck',
      '/protocol/apply-recheck',
    ]) {
      const res = await protocolAction(
        h,
        token,
        raceId,
        path,
        path.includes('qualif') ? body : { reason: 'Причина' },
      );
      expect([path, res.status, blockReason(res.body)]).toEqual([
        path,
        409,
        'protocol_not_published',
      ]);
    }
  });

  it('два одновременных DQ разных участников (RC-3): оба 200, ревизии 2 и 3, в последней оба dq', async () => {
    const { raceId, token, a, b, c } = await published();
    const [first, second] = await Promise.all([
      protocolAction(h, token, raceId, '/protocol/disqualify', { entryId: a, reason: 'Срезка' }),
      protocolAction(h, token, raceId, '/protocol/disqualify', { entryId: b, reason: 'Срезка' }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await rowsOf(raceId, 3)).toEqual([
      [c, 1, false, 'revised'],
      [a, null, false, 'dq'],
      [b, null, false, 'dq'],
    ]);
    expect(await resultsDb(h).recalculations.countDocuments({ kind: 'disqualified' })).toBe(2);
    expect(await revisedEvents()).toHaveLength(2);
  });

  it('журнал ревизий: уникальный (raceId, revision) — вторая запись той же ревизии отвергается', async () => {
    const { raceId } = await published();
    const doc = {
      raceId,
      kind: 'disqualified' as const,
      entryId: null,
      revision: 1,
      reason: 'x',
      actorUserId: uuidv7(),
      at: h.clock.now(),
    };
    await expect(resultsDb(h).recalculations.insertOne({ _id: uuidv7(), ...doc })).rejects.toThrow(
      /race_recalculations_revision_unique/,
    );
    // запуски перепроверки без ревизии не конфликтуют
    for (let i = 0; i < 2; i += 1) {
      await resultsDb(h).recalculations.insertOne({
        _id: uuidv7(),
        ...doc,
        kind: 'recheck_started',
        revision: null,
      });
    }
  });
});

describe('перепроверка после публикации (AC8, RC-1, R3)', () => {
  it('запуск → задача worker → «Применить» закрыт до конца проверок → новая ревизия по свежим вердиктам с переносом DQ', async () => {
    const race = await corridorRace(h);
    const r1 = await rider(h, 'r1@example.com');
    const r2 = await rider(h, 'r2@example.com');
    await enterRace(h, r1.auth, race.raceId);
    await enterRace(h, r2.auth, race.raceId);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, new Date('2026-10-25T09:00:00Z'));
    await uploadRide(
      h,
      await signIn(h, r1.email),
      rideGpx('clean.gpx', new Date('2026-10-25T06:00:00Z')),
    );
    await uploadRide(
      h,
      await signIn(h, r2.email),
      rideGpx('clean.gpx', new Date('2026-10-25T07:00:00Z'), { scale: 1.2 }),
    );
    await worker.drain();
    const [e1, e2] = await Promise.all(
      [r1, r2].map(async (r) => (await resultsDb(h).entries.findOne({ userId: r.userId }))!),
    );
    expect(e1!.best).not.toBeNull();
    expect(e2!.best).not.toBeNull();
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    const raceId = race.raceId;
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    expect(
      (
        await protocolAction(h, token, raceId, '/protocol/disqualify', {
          entryId: e2!._id,
          reason: 'Срезка',
        })
      ).status,
    ).toBe(200);

    // «Применить» без запуска — recheck_not_started
    const early = await protocolAction(h, token, raceId, '/protocol/apply-recheck');
    expect([early.status, blockReason(early.body)]).toEqual([409, 'recheck_not_started']);

    h.clock.advance(1000);
    const started = await protocolAction(h, token, raceId, '/protocol/recheck', {
      reason: 'Новая версия движка',
    });
    expect(started.status).toBe(200);
    expect(PanelRaceResults.parse(started.body)).toMatchObject({
      protocol: { revision: 2, recheckPending: true },
      recheck: { pending: 2 },
    });
    expect(await resultsDb(h).recalculations.findOne({ kind: 'recheck_started' })).toMatchObject({
      revision: null,
      reason: 'Новая версия движка',
    });
    expect(await panel(h).audit.findOne({ action: 'results.recheck_requested' })).toMatchObject({
      details: { revision: 2 },
    });

    // задача ещё не выполнена — незавершённые проверки
    const pending = await protocolAction(h, token, raceId, '/protocol/apply-recheck');
    expect(pending.status).toBe(409);
    expect(pending.body).toMatchObject({ details: { reason: 'checks_pending', count: 2 } });

    // задача worker: попытки — новые ревизии; повтор задачи ничего не перепоставляет; снимок не меняется
    await worker.intake();
    const requeued = await resultsDb(h).attempts.find({ raceId }).toArray();
    expect(requeued.map((attempt) => [attempt.status, attempt.checkRevision])).toEqual([
      ['queued', 2],
      ['queued', 2],
    ]);
    const requestedAt = (await resultsDb(h).recalculations.findOne({ kind: 'recheck_started' }))!
      .at;
    expect(await h.worker.get(ResultsRecheck).requestRace(raceId, requestedAt)).toBe(0);
    expect(await resultsDb(h).protocolRows.countDocuments({ revision: 3 })).toBe(0);
    const stillPending = await protocolAction(h, token, raceId, '/protocol/apply-recheck');
    expect(stillPending.body).toMatchObject({ details: { reason: 'checks_pending', count: 2 } });

    // проверки: r1 теперь не засчитан (отказ), r2 — засчитан
    const processor = h.worker.get(AttemptCheckProcessor);
    const first = requeued.find((attempt) => attempt.entryId === e1!._id)!;
    vi.spyOn(processor, 'analyze').mockResolvedValueOnce({ ok: false, code: 'implausible' });
    expect(await processor.check(first._id, 2)).toBe('rejected');
    await worker.drain();
    const applied = await protocolAction(h, token, raceId, '/protocol/apply-recheck', {
      reason: 'Пересчёт',
    });
    expect(applied.status).toBe(200);
    expect(PanelRaceResults.parse(applied.body).protocol).toMatchObject({
      revision: 3,
      recheckPending: false,
      ranked: 0,
      disqualified: 1,
    });
    // r1 выпал (нет лучшего), DQ r2 перенесён
    expect(await rowsOf(raceId, 3)).toEqual([[e2!._id, null, false, 'dq']]);
    expect((await revisedEvents()).at(-1)).toEqual([
      { raceId, revision: 3, kind: 'recheck_applied', entryId: null },
      null,
    ]);
    const again = await protocolAction(h, token, raceId, '/protocol/apply-recheck');
    expect([again.status, blockReason(again.body)]).toEqual([409, 'recheck_not_started']);
  });
});

describe('DQ переживает выпадение из ревизии (ревью pass 1)', () => {
  it('DQ → перепроверка без лучшего (выпал) → перепроверка с лучшим — строка снова dq, не место', async () => {
    const race = await corridorRace(h);
    const r1 = await rider(h, 'r1@example.com');
    const r2 = await rider(h, 'r2@example.com');
    await enterRace(h, r1.auth, race.raceId);
    await enterRace(h, r2.auth, race.raceId);
    const worker = resultsWorker(h);
    await worker.drain();
    travelTo(h, new Date('2026-10-25T09:00:00Z'));
    await uploadRide(
      h,
      await signIn(h, r1.email),
      rideGpx('clean.gpx', new Date('2026-10-25T06:00:00Z')),
    );
    await uploadRide(
      h,
      await signIn(h, r2.email),
      rideGpx('clean.gpx', new Date('2026-10-25T07:00:00Z'), { scale: 1.2 }),
    );
    await worker.drain();
    const e2 = (await resultsDb(h).entries.findOne({ userId: r2.userId }))!;
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    const raceId = race.raceId;
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    const dq = { entryId: e2._id, reason: 'Срезка' };
    expect((await protocolAction(h, token, raceId, '/protocol/disqualify', dq)).status).toBe(200);
    const processor = h.worker.get(AttemptCheckProcessor);

    /** Перепроверка: попытка r2 — отказ или засчитана; остальные — как есть; применить. */
    const recheckRound = async (r2Counted: boolean) => {
      h.clock.advance(1000);
      expect((await protocolAction(h, token, raceId, '/protocol/recheck')).status).toBe(200);
      await worker.intake();
      const attempt = (await resultsDb(h).attempts.findOne({ entryId: e2._id }))!;
      if (!r2Counted) {
        vi.spyOn(processor, 'analyze').mockResolvedValueOnce({ ok: false, code: 'implausible' });
      }
      await processor.check(attempt._id, attempt.checkRevision);
      await worker.drain();
      const res = await protocolAction(h, token, raceId, '/protocol/apply-recheck');
      expect(res.status).toBe(200);
      return PanelRaceResults.parse(res.body).protocol!.revision;
    };

    const dropped = await recheckRound(false);
    expect((await rowsOf(raceId, dropped)).map((row) => row[0])).not.toContain(e2._id);
    const back = await recheckRound(true);
    expect((await rowsOf(raceId, back)).find((row) => row[0] === e2._id)).toEqual([
      e2._id,
      null,
      false,
      'dq',
    ]);
  });
});
