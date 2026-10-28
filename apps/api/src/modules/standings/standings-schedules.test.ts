import type { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { StandingsRecalc } from './standings-recalc';
import { StandingsSchedules, StandingsSyncProcessor } from './standings-sync.processor';

describe('StandingsSchedules (race-results-08, DV-1)', () => {
  it('сверка каждую минуту по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
    const calls: unknown[][] = [];
    const queue = {
      upsertJobScheduler: (...args: unknown[]) => {
        calls.push(['upsertJobScheduler', ...args]);
        return Promise.resolve();
      },
      add: (...args: unknown[]) => {
        calls.push(['add', ...args]);
        return Promise.resolve();
      },
    } as unknown as Queue;

    await new StandingsSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'standings.sync',
        { pattern: '* * * * *', tz: 'Europe/Minsk' },
        { name: 'sync' },
      ],
      [
        'add',
        'sync',
        {},
        { jobId: 'standings.sync.boot', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });

  it('процессор: незнакомое имя задачи — ошибка, sync — прогон регламента', async () => {
    const run = { seasons: 1, recomputed: 1, stale: 0, failed: 0 };
    const processor = new StandingsSyncProcessor({
      sync: () => Promise.resolve(run),
    } as unknown as StandingsRecalc);
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow('unknown job other');
    expect(await processor.process({ name: 'sync' } as Job)).toEqual(run);
  });
});
