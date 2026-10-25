import type { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env';
import { DevicesSchedules } from './devices-maintenance.processor';

function fakeQueue() {
  const calls: unknown[][] = [];
  const queue = {
    upsertJobScheduler: (...args: unknown[]) => {
      calls.push(['upsert', ...args]);
      return Promise.resolve();
    },
    removeJobScheduler: (...args: unknown[]) => {
      calls.push(['remove', ...args]);
      return Promise.resolve(true);
    },
  } as unknown as Queue;
  return { queue, calls };
}

const env = (enabled: boolean) =>
  ({ DEVICES_ENABLED: enabled, DEVICES_SYNC_INTERVAL_MIN: 15 }) as Env;

describe('DevicesSchedules', () => {
  it('устройства включены: pull каждые DEVICES_SYNC_INTERVAL_MIN, уборка каждые 10 мин, сверка ежедневно (upsert)', async () => {
    const { queue, calls } = fakeQueue();
    await new DevicesSchedules(queue, env(true)).onApplicationBootstrap();
    expect(calls).toEqual([
      ['upsert', 'devices.schedule-pull', { every: 900_000 }, { name: 'schedule-pull' }],
      ['upsert', 'devices.cleanup-pending', { every: 600_000 }, { name: 'cleanup-pending' }],
      [
        'upsert',
        'devices.reconcile.daily',
        { pattern: '30 4 * * *', tz: 'Europe/Minsk' },
        { name: 'reconcile' },
      ],
    ]);
  });

  it('устройства выключены — расписания снимаются', async () => {
    const { queue, calls } = fakeQueue();
    await new DevicesSchedules(queue, env(false)).onApplicationBootstrap();
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ['remove', 'devices.schedule-pull'],
      ['remove', 'devices.cleanup-pending'],
      ['remove', 'devices.reconcile.daily'],
    ]);
  });
});
