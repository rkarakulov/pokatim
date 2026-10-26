import { MyRaceEntry, PanelRace } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decideDispute,
  DISPUTE_PROTOCOL_PLANNED,
  disputeRace,
  disputesDb,
  fileDispute,
  filedId,
  refusal,
  travelFresh,
} from '../../../test/disputes';
import { createHarness, type Harness, HOUR } from '../../../test/harness';
import { gate, untilBlocked } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { RACES, racesDb, racesRepository } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  protocolAction,
  resultsDb,
  resultsRepository,
  rider,
  seedBest,
  signIn,
  travelTo,
  withdraw,
} from '../../../test/results';
import { RESULTS_FOR_DISPUTES, type ResultsForDisputes } from '../results';
import { DisputesRepository } from './disputes.repository';

/**
 * Конкурентность споров (race-results-06, AC10, RC-17) на реальном MongoDB (snapshot-изоляция). Ворота `gate()`
 * останавливают подачу после захвата замков; вторая операция упирается в незакоммиченную запись и повторяется
 * (`untilBlocked`). Отрицательные доказательства: замок подменён чтением — обе операции проходят, инвариант нарушен
 * (тест проверяет результат, не таймаут). Итог — task.md §12.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const port = () => h.app.get<ResultsForDisputes>(RESULTS_FOR_DISPUTES, { strict: false });

/** Ворота на `countOpenByComplainant` подачи — после `lockResults` и `lockEntry` цели. */
function gateAfterTargetLock() {
  const g = gate();
  const original = DisputesRepository.prototype.countOpenByComplainant;
  vi.spyOn(DisputesRepository.prototype, 'countOpenByComplainant').mockImplementationOnce(
    async function (this: DisputesRepository, ...args) {
      await g.wait();
      return original.apply(this, args);
    },
  );
  return g;
}

/** Окно открыто (отмена участия доступна), у обоих райдеров засчитанный результат. */
async function openWindowRace() {
  const race = await corridorRace(h, { protocolPlannedAt: DISPUTE_PROTOCOL_PLANNED });
  const entered = [];
  for (const [index, email] of ['me@example.com', 'rival@example.com'].entries()) {
    const r = await rider(h, email);
    const entry = MyRaceEntry.parse((await enterRace(h, r.auth, race.raceId)).body).entry!;
    await seedBest(h, entry.id, 3600 + index * 100, new Date(`2026-10-25T0${index}:00:00Z`));
    entered.push({ ...r, entryId: entry.id });
  }
  travelTo(h, new Date('2026-10-25T08:00:00Z'));
  const riders = [];
  for (const r of entered) riders.push({ ...r, auth: await signIn(h, r.email) });
  return { ...race, riders };
}

describe('подача ↔ отмена участия цели (lockEntry цели)', () => {
  it('с замком: отмена повторяется и получает dispute_open, спор открыт против активной заявки', async () => {
    const { raceId, riders } = await openWindowRace();
    const [me, rival] = riders;
    const g = gateAfterTargetLock();
    const lockSpy = vi.spyOn(resultsRepository(h), 'lockEntryOf');
    const filing = fileDispute(h, me!.auth, raceId, {
      targetEntryId: rival!.entryId,
      category: 'other',
    });
    await g.reached;
    const withdrawing = withdraw(h, rival!.auth, raceId);
    await untilBlocked(withdrawing, () => Promise.resolve(lockSpy.mock.calls.length >= 2));
    g.open();
    const [filed, withdrawn] = await Promise.all([filing, withdrawing]);
    expect(filed.status).toBe(201);
    expect(refusal(withdrawn)).toEqual([409, 'RACE_WITHDRAW_CLOSED', 'dispute_open']);
    expect((await resultsDb(h).entries.findOne({ _id: rival!.entryId }))?.status).toBe('active');
  });

  it('отрицательное доказательство: lockEntry цели подменён чтением — обе проходят, спор против отменённой заявки', async () => {
    const { raceId, riders } = await openWindowRace();
    const [me, rival] = riders;
    const results = port();
    vi.spyOn(results, 'lockEntry').mockImplementation((tx, entryId) => results.entry(entryId, tx));
    const g = gateAfterTargetLock();
    const filing = fileDispute(h, me!.auth, raceId, {
      targetEntryId: rival!.entryId,
      category: 'other',
    });
    await g.reached;
    const withdrawn = await withdraw(h, rival!.auth, raceId);
    g.open();
    expect(withdrawn.status).toBe(200);
    expect((await filing).status).toBe(201);
    expect((await resultsDb(h).entries.findOne({ _id: rival!.entryId }))?.status).toBe('withdrawn');
    expect(await disputesDb(h).disputes.countDocuments({ status: 'open' })).toBe(1);
  });
});

describe('подача ↔ публикация (lockResults в подаче)', () => {
  /** Ворота на `entryOf` подачи — после `lockResults`. */
  function gateAfterRaceLock() {
    const g = gate();
    const results = port();
    const entryOf = results.entryOf.bind(results);
    vi.spyOn(results, 'entryOf').mockImplementationOnce(async (...args) => {
      await g.wait();
      return entryOf(...args);
    });
    return g;
  }

  it('с замком: публикация повторяется и получает RESULTS_PUBLISH_BLOCKED (open_disputes: 1)', async () => {
    const { raceId, riders, token } = await disputeRace(h, [3600, 3700]);
    const g = gateAfterRaceLock();
    const lockSpy = vi.spyOn(racesRepository(h), 'lockResults');
    const filing = fileDispute(h, riders[0]!.auth, raceId, {
      targetEntryId: riders[1]!.entryId,
      category: 'other',
    });
    await g.reached;
    const publishing = protocolAction(h, token, raceId, '/protocol');
    // подача — 1 вызов замка; публикация — повтор после конфликта записи
    await untilBlocked(publishing, () => Promise.resolve(lockSpy.mock.calls.length >= 3));
    g.open();
    const [filed, published] = await Promise.all([filing, publishing]);
    expect(filed.status).toBe(201);
    expect([published.status, published.body]).toMatchObject([
      409,
      {
        code: 'RESULTS_PUBLISH_BLOCKED',
        details: { checklist: expect.arrayContaining([{ code: 'open_disputes', count: 1 }]) },
      },
    ]);
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.protocolPublishedAt).toBeNull();
  });

  it('отрицательное доказательство: lockResults подменён чтением — спор открыт при опубликованном протоколе', async () => {
    const { raceId, riders, token } = await disputeRace(h, [3600, 3700]);
    const repository = racesRepository(h);
    vi.spyOn(repository, 'lockResults').mockImplementation((tx, id) =>
      repository.findRace(id, tx).then((doc) => doc ?? null),
    );
    const g = gateAfterRaceLock();
    const filing = fileDispute(h, riders[0]!.auth, raceId, {
      targetEntryId: riders[1]!.entryId,
      category: 'other',
    });
    await g.reached;
    const published = await protocolAction(h, token, raceId, '/protocol');
    g.open();
    expect(published.status).toBe(200);
    expect((await filing).status).toBe(201);
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.protocolPublishedAt).not.toBeNull();
    expect(await disputesDb(h).disputes.countDocuments({ status: 'open' })).toBe(1);
  });
});

describe('решение ↔ решение, подача ↔ отмена гонки', () => {
  it('два параллельных решения — одно 200, другое not_open; одна запись журнала', async () => {
    const race = await disputeRace(h, [3600, 3700]);
    const id = filedId(
      await fileDispute(h, race.riders[0]!.auth, race.raceId, {
        targetEntryId: race.riders[1]!.entryId,
        category: 'other',
      }),
    );
    const { token } = await travelFresh(h, new Date(h.clock.now().getTime() + 12 * HOUR), []);
    const results = await Promise.all([
      decideDispute(h, token, id, { outcome: 'upheld', template: 'rules_violation' }),
      decideDispute(h, token, id, { outcome: 'rejected', template: 'track_confirmed' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(refusal(results.find((res) => res.status === 409)!)).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_open',
    ]);
    expect(await disputesDb(h).events.countDocuments({ kind: 'decided' })).toBe(1);
  });

  it('подача ↔ отмена гонки — побеждает одна: нет открытого спора на отменённой гонке', async () => {
    const race = await disputeRace(h, [3600, 3700]);
    const current = PanelRace.parse(
      (await panelCall(h, race.token, 'GET', `${RACES}/${race.raceId}`)).body,
    );
    const [filed, cancelled] = await Promise.all([
      fileDispute(h, race.riders[0]!.auth, race.raceId, {
        targetEntryId: race.riders[1]!.entryId,
        category: 'other',
      }),
      panelCall(h, race.token, 'POST', `${RACES}/${race.raceId}/cancel`, {
        version: current.version,
        reason: 'weather',
      }),
    ]);
    const status = (await racesDb(h).races.findOne({ _id: race.raceId }))?.status;
    const open = await disputesDb(h).disputes.countDocuments({ status: 'open' });
    if (cancelled.status === 200) {
      expect(refusal(filed)).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'cancelled']);
      expect([status, open]).toEqual(['cancelled', 0]);
    } else {
      expect(filed.status).toBe(201);
      expect(refusal(cancelled)).toEqual([409, 'RACE_INVALID_STATE', 'disputes_open']);
      expect([status, open]).toEqual(['published', 1]);
    }
  });
});
