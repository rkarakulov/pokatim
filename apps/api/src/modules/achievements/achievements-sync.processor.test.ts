import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AchievementsReconciler } from './achievements-reconciler';
import type { AchievementsSweep } from './achievements-sweep';
import { AchievementsSchedules, AchievementsSyncProcessor } from './achievements-sync.processor';

afterEach(() => {
  vi.restoreAllMocks();
});

const job = (name: string, data: unknown, attemptsMade = 0) =>
  ({ name, data, attemptsMade, opts: { attempts: 3 } }) as unknown as Job;

describe('AchievementsSchedules (achievements-push N2)', () => {
  it('регламент каждую минуту по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
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

    await new AchievementsSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'achievements.sweep',
        { pattern: '* * * * *', tz: 'Europe/Minsk' },
        {
          name: 'achievements.sweep',
          opts: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 100 } },
        },
      ],
      [
        'add',
        'achievements.sweep',
        {},
        {
          jobId: 'achievements.sweep.boot',
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      ],
    ]);
  });
});

describe('AchievementsSyncProcessor', () => {
  const run = { busy: false, read: {}, enqueued: 0, failedSources: [] };
  const setup = (reconcile: () => Promise<unknown>) => {
    const sweep = { run: vi.fn(() => Promise.resolve(run)) };
    const reconciler = { reconcile: vi.fn(reconcile) };
    const processor = new AchievementsSyncProcessor(
      sweep as unknown as AchievementsSweep,
      reconciler as unknown as AchievementsReconciler,
    );
    return { sweep, reconciler, processor };
  };

  it('sweep — прогон регламента; rider — сверка с origin server; незнакомое имя — ошибка', async () => {
    const { sweep, reconciler, processor } = setup(() => Promise.resolve({}));
    expect(await processor.process(job('achievements.sweep', {}))).toBe(run);
    expect(sweep.run).toHaveBeenCalledOnce();
    expect(await processor.process(job('achievements.rider', { userId: 'u-1' }))).toBe(
      'reconciled',
    );
    expect(reconciler.reconcile).toHaveBeenCalledWith('u-1', 'server');
    await expect(processor.process(job('other', {}))).rejects.toThrow(/unknown job other/);
  });

  it('последняя попытка задачи райдера — лог achievements.server_sync_failed и ошибка дальше; не последняя — без лога', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { processor } = setup(() => Promise.reject(new Error('mongo down')));
    await expect(
      processor.process(job('achievements.rider', { userId: 'u-1' }, 1)),
    ).rejects.toThrow('mongo down');
    expect(error).not.toHaveBeenCalled();
    await expect(
      processor.process(job('achievements.rider', { userId: 'u-1' }, 2)),
    ).rejects.toThrow('mongo down');
    expect(error).toHaveBeenCalledWith('achievements.server_sync_failed uid=u-1 attempts=3');
  });
});
