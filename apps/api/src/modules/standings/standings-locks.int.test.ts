import { MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate, untilBlocked } from '../../../test/identity';
import {
  type SeasonStandingRowDoc,
  type SeasonStandingsDoc,
  standingsCollections,
} from './standings.collection';
import { STANDINGS_FORMULA_VERSION } from './standings.policy';
import { StandingsRecalc } from './standings-recalc';
import { StandingsRepository } from './standings.repository';

/**
 * Запись снимка сезона под условием версии источника (race-results-08, RC-5): устаревший пересчёт не перезаписывает
 * более новый снимок. Ворота — `claimSeason` приостановлен до первой операции транзакции; отрицательное
 * доказательство — `claimSeason` без условия версии в фильтре.
 */
let h: Harness;
let recalc: StandingsRecalc;
let repository: StandingsRepository;
beforeAll(async () => {
  h = await createHarness();
  recalc = h.worker.get(StandingsRecalc, { strict: false });
  repository = h.worker.get(StandingsRepository, { strict: false });
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

const SEASON = uuidv7();
const db = () => standingsCollections(h.db);

function header(
  sourceVersion: number,
  formulaVersion = STANDINGS_FORMULA_VERSION,
): SeasonStandingsDoc {
  return {
    _id: SEASON,
    formulaVersion,
    sourceVersion,
    fingerprint: `fp-${formulaVersion}-${sourceVersion}`,
    computedAt: h.clock.now(),
    races: [],
    tables: [],
  };
}

/** Строки снимка версии: у каждой версии свой райдер — видно, чья запись осталась. */
function rows(sourceVersion: number, count = 2): SeasonStandingRowDoc[] {
  return Array.from({ length: count }, (_, order) => ({
    _id: uuidv7(),
    seasonId: SEASON,
    bikeClass: 'road',
    groupKey: 'm_u40',
    order,
    userId: `user-v${sourceVersion}-${order}`,
    place: order + 1,
    tied: false,
    points: 100 - order,
    cells: [],
  }));
}

async function stored() {
  const doc = await db().seasons.findOne({ _id: SEASON });
  const users = (await db().rows.find({ seasonId: SEASON }).sort({ order: 1 }).toArray()).map(
    (row) => row.userId,
  );
  return { sourceVersion: doc?.sourceVersion ?? null, formulaVersion: doc?.formulaVersion, users };
}

/** Версия 1 ждёт у ворот до первой операции транзакции (`claimSeason`). */
function gateVersionOne() {
  const g = gate();
  const original = repository.claimSeason.bind(repository);
  const spy = vi.spyOn(repository, 'claimSeason').mockImplementation(async (tx, doc) => {
    if (doc.sourceVersion === 1) await g.wait();
    return original(tx, doc);
  });
  return { g, spy };
}

describe('снимок сезона не откатывается (RC-5, AC7)', () => {
  it('версия 2 коммитится раньше начатой раньше версии 1 → итог 2, версия 1 — stale, её строк нет', async () => {
    const { g } = gateVersionOne();
    const older = recalc.writeSnapshot(header(1), rows(1));
    await g.reached;
    expect(await recalc.writeSnapshot(header(2), rows(2))).toBe('written');
    g.open();
    expect(await older).toBe('stale');
    expect(await stored()).toEqual({
      sourceVersion: 2,
      formulaVersion: STANDINGS_FORMULA_VERSION,
      users: ['user-v2-0', 'user-v2-1'],
    });
  });

  it('отрицательное доказательство: без условия версии в фильтре claimSeason — снимок откатывается к 1', async () => {
    const g = gate();
    const worker = h.worker.get<Db>(MONGO_DB, { strict: false });
    vi.spyOn(repository, 'claimSeason').mockImplementation(async (tx, doc) => {
      if (doc.sourceVersion === 1) await g.wait();
      const { _id, ...set } = doc;
      await standingsCollections(worker).seasons.updateOne(
        { _id },
        { $set: set },
        { session: tx, upsert: true },
      );
    });
    const older = recalc.writeSnapshot(header(1), rows(1));
    await g.reached;
    expect(await recalc.writeSnapshot(header(2), rows(2))).toBe('written');
    g.open();
    expect(await older).toBe('written');
    expect(await stored()).toEqual({
      sourceVersion: 1,
      formulaVersion: STANDINGS_FORMULA_VERSION,
      users: ['user-v1-0', 'user-v1-1'],
    });
  });

  it('версия 2 ждёт незакоммиченную версию 1 (конфликт записи заголовка) и пишет после неё', async () => {
    const g = gate();
    const replaceRows = repository.replaceRows.bind(repository);
    vi.spyOn(repository, 'replaceRows').mockImplementation(async (tx, seasonId, docs) => {
      if (docs[0]?.userId.startsWith('user-v1')) await g.wait();
      return replaceRows(tx, seasonId, docs);
    });
    const claim = vi.spyOn(repository, 'claimSeason');
    const older = recalc.writeSnapshot(header(1), rows(1));
    await g.reached;
    const newer = recalc.writeSnapshot(header(2), rows(2));
    // заголовок записан незакоммиченной версией 1: версия 2 повторяет транзакцию
    const newerClaims = () => claim.mock.calls.filter(([, doc]) => doc.sourceVersion === 2).length;
    await untilBlocked(newer, () => Promise.resolve(newerClaims() >= 2));
    expect(newerClaims()).toBeGreaterThanOrEqual(2);
    g.open();
    expect(await older).toBe('written');
    expect(await newer).toBe('written');
    expect((await stored()).sourceVersion).toBe(2);
    expect((await stored()).users).toEqual(['user-v2-0', 'user-v2-1']);
  });

  it('первый снимок двумя параллельными транзакциями одной версии — один победитель, второй stale', async () => {
    const results = await Promise.all([
      recalc.writeSnapshot(header(3), rows(3)),
      recalc.writeSnapshot(header(3), rows(3, 3)),
    ]);
    expect([...results].sort()).toEqual(['stale', 'written']);
    const { users } = await stored();
    // строки — ровно одной из записей, не смесь
    expect([2, 3]).toContain(users.length);
  });

  it('повтор той же версии — stale без изменений; новая формула пишет при меньшей sourceVersion, старая — stale', async () => {
    expect(await recalc.writeSnapshot(header(5), rows(5))).toBe('written');
    expect(await recalc.writeSnapshot(header(5), rows(5, 1))).toBe('stale');
    expect((await stored()).users).toHaveLength(2);
    expect(await recalc.writeSnapshot(header(1, STANDINGS_FORMULA_VERSION + 1), rows(1))).toBe(
      'written',
    );
    expect(await recalc.writeSnapshot(header(9), rows(9))).toBe('stale');
    expect(await stored()).toEqual({
      sourceVersion: 1,
      formulaVersion: STANDINGS_FORMULA_VERSION + 1,
      users: ['user-v1-0', 'user-v1-1'],
    });
  });
});
