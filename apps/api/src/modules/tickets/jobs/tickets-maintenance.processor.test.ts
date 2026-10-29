import type { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { RaceTickets } from '../race-tickets';
import { TicketsMaintenanceProcessor, TicketsSchedules } from './tickets-maintenance.processor';

describe('регламент билетов (tickets-maintenance)', () => {
  it('сверка каждую минуту по Минску (upsert) и разовый прогон при старте worker', async () => {
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

    await new TicketsSchedules(queue).onApplicationBootstrap();

    expect(calls).toEqual([
      [
        'upsertJobScheduler',
        'tickets.reconcile',
        { pattern: '* * * * *', tz: 'Europe/Minsk' },
        { name: 'tickets.reconcile' },
      ],
      [
        'add',
        'tickets.reconcile',
        {},
        { jobId: 'tickets.reconcile.boot', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
  });

  it('процессор: незнакомое имя — ошибка; tickets.reconcile — сверка', async () => {
    const run = { races: 1, issued: 2, failed: 0 };
    const processor = new TicketsMaintenanceProcessor({
      reconcileAll: () => Promise.resolve(run),
    } as unknown as RaceTickets);
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow('unknown job other');
    expect(await processor.process({ name: 'tickets.reconcile' } as Job)).toEqual(run);
  });
});
