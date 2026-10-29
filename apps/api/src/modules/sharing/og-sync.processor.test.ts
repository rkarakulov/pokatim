import type { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { OgSync } from './og-sync';
import { OgSchedules, OgSyncProcessor } from './og-sync.processor';

describe('OgSchedules (og-images, DV-1)', () => {
  it('og.sync каждую минуту по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
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

    await new OgSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'og.sync',
        { pattern: '* * * * *', tz: 'Europe/Minsk' },
        { name: 'sync' },
      ],
      ['add', 'sync', {}, { jobId: 'og.sync.boot', removeOnComplete: true, removeOnFail: true }],
    ]);
  });

  it('процессор: незнакомое имя задачи — ошибка, sync — прогон', async () => {
    const run = {
      reset: false,
      brand: false,
      scanned: { race: 0, ride: 0, route: 0, calendar: 0 },
      enqueued: 0,
      failedKinds: [],
    };
    const processor = new OgSyncProcessor({ run: () => Promise.resolve(run) } as unknown as OgSync);
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow('unknown job other');
    expect(await processor.process({ name: 'sync' } as Job)).toEqual(run);
  });
});
