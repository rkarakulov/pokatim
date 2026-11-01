import type { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { RouteRidesSchedules } from './route-rides-maintenance.processor';

describe('RouteRidesSchedules (route-rides-08)', () => {
  it('уборщик сирот раз в сутки по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
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

    await new RouteRidesSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'route-rides.orphans.daily',
        { pattern: '23 4 * * *', tz: 'Europe/Minsk' },
        { name: 'orphans' },
      ],
      [
        'add',
        'orphans',
        {},
        { jobId: 'route-rides.orphans.boot', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });
});
