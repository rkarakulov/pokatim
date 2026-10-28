import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { racesDb } from '../../../test/races';
import { protocolAction, protocolRace } from '../../../test/results';
import {
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
  standingsDb,
  syncStandings,
} from '../../../test/standings';
import { RESULTS_FOR_STANDINGS, type ResultsForStandings } from '../results';
import { STANDINGS_FORMULA_VERSION } from './standings.policy';
import { StandingsRepository } from './standings.repository';

/**
 * Регламент рейтинга сезона (race-results-08, AC7, RC-13): снимок по опубликованным протоколам, обновление по новой
 * ревизии, без изменений — без записи, отказ одного сезона не блокирует другие.
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

const rowsOf = async (seasonId: string) =>
  (
    await standingsDb(h)
      .rows.find({ seasonId })
      .sort({ bikeClass: 1, groupKey: 1, order: 1 })
      .toArray()
  ).map((row) => [row.groupKey, row.userId, row.place, row.points]);

describe('регламент standings.sync (AC7)', () => {
  it('публикация протокола → снимок после прогона; DQ (новая ревизия) → обновлён; повтор без изменений — без записи', async () => {
    const race = await protocolRace(h, [3600, 3700]);
    const [first, second] = race.riders;
    const seasonId = (await racesDb(h).races.findOne({ _id: race.raceId }))!.seasonId!;
    // до публикации — снимка нет
    expect(await syncStandings(h)).toEqual({
      seasons: 0,
      recomputed: 0,
      stale: 0,
      conflicts: 0,
      failed: 0,
    });
    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);

    expect(await syncStandings(h)).toEqual({
      seasons: 1,
      recomputed: 1,
      stale: 0,
      conflicts: 0,
      failed: 0,
    });
    const header = await standingsDb(h).seasons.findOne({ _id: seasonId });
    expect(header).toMatchObject({
      formulaVersion: STANDINGS_FORMULA_VERSION,
      sourceVersion: 1,
      races: [
        {
          raceId: race.raceId,
          bikeClass: 'road',
          groupScheme: 'overall',
          revision: 1,
        },
      ],
      tables: [
        {
          bikeClass: 'road',
          groupKey: 'overall',
          raceIds: [race.raceId],
          racesTotal: 1,
          racesCounted: 1,
          riders: 2,
        },
      ],
    });
    expect(await rowsOf(seasonId)).toEqual([
      ['overall', first!.userId, 1, 100],
      ['overall', second!.userId, 2, 85],
    ]);

    const dq = await protocolAction(h, race.token, race.raceId, '/protocol/disqualify', {
      entryId: first!.entryId,
      reason: 'Срезка маршрута',
    });
    expect(dq.status).toBe(200);
    expect(await syncStandings(h)).toMatchObject({ recomputed: 1 });
    expect((await standingsDb(h).seasons.findOne({ _id: seasonId }))!.sourceVersion).toBe(2);
    expect(await rowsOf(seasonId)).toEqual([
      ['overall', second!.userId, 1, 100],
      ['overall', first!.userId, 2, 0],
    ]);

    // без изменений: claimSeason не вызывается, computedAt тот же
    const before = (await standingsDb(h).seasons.findOne({ _id: seasonId }))!.computedAt;
    const claim = vi.spyOn(h.worker.get(StandingsRepository, { strict: false }), 'claimSeason');
    h.clock.advance(60_000);
    expect(await syncStandings(h)).toEqual({
      seasons: 1,
      recomputed: 0,
      stale: 0,
      conflicts: 0,
      failed: 0,
    });
    expect(claim).not.toHaveBeenCalled();
    expect((await standingsDb(h).seasons.findOne({ _id: seasonId }))!.computedAt).toEqual(before);
  });

  it('гонки двух схем в сезоне: overall — своя таблица; гонка с протоколом без заявок — gender_age (RC-2)', async () => {
    const seasonId = await seedSeason(h);
    await seedProtocolRace(h, seasonId, [{ userId: 'u-old', place: 1 }], {
      groupScheme: 'overall',
      windowEndsAt: new Date('2026-05-01T20:59:00Z'),
    });
    await seedProtocolRace(h, seasonId, [placedRow('u-new', 1), dqRow('u-dq')], {
      windowEndsAt: new Date('2026-06-01T20:59:00Z'),
    });
    const empty = await seedProtocolRace(h, seasonId, [], {
      groupScheme: null,
      windowEndsAt: new Date('2026-07-01T20:59:00Z'),
    });
    await syncStandings(h);
    const header = (await standingsDb(h).seasons.findOne({ _id: seasonId }))!;
    expect(header.races.find((race) => race.raceId === empty)?.groupScheme).toBe('gender_age');
    expect(header.tables.map((table) => [table.groupKey, table.racesTotal, table.riders])).toEqual([
      ['overall', 1, 1],
      ['m_u40', 2, 2],
    ]);
    expect(await rowsOf(seasonId)).toEqual([
      ['m_u40', 'u-new', 1, 100],
      ['m_u40', 'u-dq', 2, 0],
      ['overall', 'u-old', 1, 100],
    ]);
  });

  it('гонка с протоколом без ревизии — пропущена; сезон без протоколов — снимка нет', async () => {
    const seasonId = await seedSeason(h);
    await seedProtocolRace(h, seasonId, [placedRow('a', 1)]);
    const broken = await seedProtocolRace(h, seasonId, [], { recalculations: false });
    const quiet = await seedSeason(h, 'Сезон без протоколов');
    await seedProtocolRace(h, quiet, [placedRow('b', 1)], { protocol: false });
    expect(await syncStandings(h)).toEqual({
      seasons: 1,
      recomputed: 1,
      stale: 0,
      conflicts: 0,
      failed: 0,
    });
    const header = (await standingsDb(h).seasons.findOne({ _id: seasonId }))!;
    expect(header.races.map((race) => race.raceId)).not.toContain(broken);
    expect(await standingsDb(h).seasons.findOne({ _id: quiet })).toBeNull();
  });

  it('снимок не старше источника, а отпечаток другой — пропуск без пересчёта (version_conflict, ревью LOW-1)', async () => {
    const seasonId = await seedSeason(h);
    await seedProtocolRace(h, seasonId, [placedRow('a', 1)]);
    await syncStandings(h);
    // как после отката деплоя: сохранённый снимок «новее» источника и с другим отпечатком
    await standingsDb(h).seasons.updateOne(
      { _id: seasonId },
      { $set: { fingerprint: 'from-newer-release' }, $inc: { sourceVersion: 5 } },
    );
    const claim = vi.spyOn(h.worker.get(StandingsRepository, { strict: false }), 'claimSeason');
    expect(await syncStandings(h)).toEqual({
      seasons: 1,
      recomputed: 0,
      stale: 0,
      conflicts: 1,
      failed: 0,
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('отказ пересчёта одного сезона не блокирует другой; задача падает, следующий прогон повторяет', async () => {
    const failing = await seedSeason(h, 'Сезон А');
    const failingRace = await seedProtocolRace(h, failing, [placedRow('a', 1)]);
    const healthy = await seedSeason(h, 'Сезон Б');
    await seedProtocolRace(h, healthy, [placedRow('b', 1)]);
    const port = h.worker.get<ResultsForStandings>(RESULTS_FOR_STANDINGS, { strict: false });
    const original = port.protocolRows.bind(port);
    const spy = vi
      .spyOn(port, 'protocolRows')
      .mockImplementation((raceId, revision) =>
        raceId === failingRace ? Promise.reject(new Error('boom')) : original(raceId, revision),
      );
    await expect(syncStandings(h)).rejects.toThrow('standings.sync_failed');
    expect(await standingsDb(h).seasons.findOne({ _id: healthy })).not.toBeNull();
    expect(await standingsDb(h).seasons.findOne({ _id: failing })).toBeNull();

    spy.mockRestore();
    expect(await syncStandings(h)).toEqual({
      seasons: 2,
      recomputed: 1,
      stale: 0,
      conflicts: 0,
      failed: 0,
    });
    expect(await rowsOf(failing)).toEqual([['m_u40', 'a', 1, 100]]);
  });
});
