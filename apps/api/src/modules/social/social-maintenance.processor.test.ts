import type { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { RideAskSweep } from './ride-ask-sweep';
import { SocialMaintenanceProcessor, SocialSchedules } from './social-maintenance.processor';

describe('регламент «Свои» (social-maintenance, P5)', () => {
  it('«Как прошёл райд?» раз в 30 мин по Минску (upsert) и разовый прогон при старте worker', async () => {
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

    await new SocialSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'social.ride-ask',
        { pattern: '*/30 * * * *', tz: 'Europe/Minsk' },
        { name: 'social.ride-ask' },
      ],
      [
        'add',
        'social.ride-ask',
        {},
        { jobId: 'social.ride-ask.boot', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });

  it('процессор: незнакомое имя — ошибка; social.ride-ask — регламент', async () => {
    const run = { rides: 1, asked: 1, recipients: 2, failed: 0 };
    const processor = new SocialMaintenanceProcessor({
      run: () => Promise.resolve(run),
    } as unknown as RideAskSweep);
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow('unknown job other');
    expect(await processor.process({ name: 'social.ride-ask' } as Job)).toEqual(run);
  });
});
