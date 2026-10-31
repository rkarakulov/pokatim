import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { outboxEvents } from '../../../test/identity';
import { racesDb } from '../../../test/races';
import { protocolAction, protocolRace } from '../../../test/results';
import { runStandingsEvents, standingsDb, standingsRecalc } from '../../../test/standings';
import { StandingsSyncProcessor } from './standings-sync.processor';
import { StandingsRepository } from './standings.repository';

/**
 * Пересчёт рейтинга по событиям outbox (standings-outbox-events): `results.protocol-published` и
 * `results.result-revised` → задача `standings-recalc` пересчитывает сезон гонки без регламента.
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
  (await standingsDb(h).rows.find({ seasonId }).sort({ order: 1 }).toArray()).map((row) => [
    row.userId,
    row.place,
    row.points,
  ]);

const lastEventId = async () => (await outboxEvents(h)).at(-1)?._id ?? '';

describe('standings по событиям results (AC2–AC4)', () => {
  it('protocol-published → снимок сезона; result-revised (DQ) → обновлён; повтор задачи — без записи', async () => {
    const race = await protocolRace(h, [3600, 3700]);
    const [first, second] = race.riders;
    const seasonId = (await racesDb(h).races.findOne({ _id: race.raceId }))!.seasonId!;

    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
    expect(await runStandingsEvents(h)).toEqual(['recomputed']);
    expect((await standingsDb(h).seasons.findOne({ _id: seasonId }))!.sourceVersion).toBe(1);
    expect(await rowsOf(seasonId)).toEqual([
      [first!.userId, 1, 100],
      [second!.userId, 2, 85],
    ]);

    const published = await lastEventId();
    const dq = await protocolAction(h, race.token, race.raceId, '/protocol/disqualify', {
      entryId: first!.entryId,
      reason: 'Срезка маршрута',
    });
    expect(dq.status).toBe(200);
    expect(await runStandingsEvents(h, published)).toEqual(['recomputed']);
    expect((await standingsDb(h).seasons.findOne({ _id: seasonId }))!.sourceVersion).toBe(2);
    expect(await rowsOf(seasonId)).toEqual([
      [second!.userId, 1, 100],
      [first!.userId, 2, 0],
    ]);

    // повтор доставки (at-least-once): снимок совпадает — claimSeason не вызывается
    const claim = vi.spyOn(h.worker.get(StandingsRepository, { strict: false }), 'claimSeason');
    expect(await runStandingsEvents(h)).toEqual(['unchanged', 'unchanged']);
    expect(claim).not.toHaveBeenCalled();
  });

  it('гонка без протокола или неизвестная, невалидный payload — пропуск без исключения', async () => {
    const race = await protocolRace(h, [3600]);
    const processor = h.worker.get(StandingsSyncProcessor, { strict: false });
    const recalc = standingsRecalc(h);
    expect(await recalc.syncRace(race.raceId)).toBe('skipped');
    expect(await recalc.syncRace('019a0000-0000-7000-8000-000000000000')).toBe('skipped');

    const job = (name: string, outboxEventId: string) =>
      ({ name, data: { outboxEventId }, attemptsMade: 0, opts: { attempts: 5 } }) as never;
    // события нет в outbox — payload невалиден
    expect(
      await processor.process(
        job('results.protocol-published', '019a0000-0000-7000-8000-000000000001'),
      ),
    ).toBe('skipped');
    expect(await standingsDb(h).seasons.countDocuments()).toBe(0);
  });

  it('отказ пересчёта по событию — задача падает (ретрай BullMQ), повтор после сбоя строит снимок', async () => {
    const race = await protocolRace(h, [3600]);
    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
    const recompute = vi
      .spyOn(standingsRecalc(h), 'recompute')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(runStandingsEvents(h)).rejects.toThrow('standings.sync_failed');
    expect(await standingsDb(h).seasons.countDocuments()).toBe(0);
    recompute.mockRestore();
    expect(await runStandingsEvents(h)).toEqual(['recomputed']);
  });
});
