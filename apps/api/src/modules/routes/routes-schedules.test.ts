import type { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { RoutesSchedules } from './routes-maintenance.processor';

describe('RoutesSchedules (routes-03, RC-13)', () => {
  it('бэкфилл каждые 10 мин по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
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

    await new RoutesSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'routes.maintenance',
        { pattern: '*/10 * * * *', tz: 'Europe/Minsk' },
        { name: 'derive' },
      ],
      [
        'add',
        'derive',
        {},
        { jobId: 'routes.derive.boot', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });
});
