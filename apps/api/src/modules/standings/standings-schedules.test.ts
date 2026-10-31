import type { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { StandingsRecalc } from './standings-recalc';
import { StandingsSchedules, StandingsSyncProcessor } from './standings-sync.processor';

describe('StandingsSchedules (race-results-08, standings-outbox-events S1)', () => {
  it('страховка каждые 15 мин по Минску (upsert — без дублей) и разовый прогон при старте worker', async () => {
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
        { pattern: '*/15 * * * *', tz: 'Europe/Minsk' },
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

  it('процессор: незнакомое имя задачи — ошибка, sync — прогон регламента, событие — сверка сезона гонки', async () => {
    const run = { seasons: 1, recomputed: 1, stale: 0, conflicts: 0, failed: 0 };
    const raceId = '019a0000-0000-7000-8000-00000000000a';
    const payloads: Record<string, unknown> = {
      published: { raceId, revision: 1 },
      revised: { raceId, revision: 2, kind: 'disqualified', entryId: null },
      broken: { raceId: 'nope' },
    };
    const synced: string[] = [];
    const processor = new StandingsSyncProcessor(
      {
        sync: () => Promise.resolve(run),
        syncRace: (id: string) => {
          synced.push(id);
          return Promise.resolve('recomputed');
        },
      } as unknown as StandingsRecalc,
      { payloadOf: (id: string) => Promise.resolve(payloads[id]) } as unknown as MongoOutboxReader,
    );
    const job = (name: string, outboxEventId?: string) =>
      ({ name, data: { outboxEventId } }) as unknown as Job;
    await expect(processor.process(job('other'))).rejects.toThrow('unknown job other');
    expect(await processor.process(job('sync'))).toEqual(run);
    expect(await processor.process(job('results.protocol-published', 'published'))).toBe(
      'recomputed',
    );
    expect(await processor.process(job('results.result-revised', 'revised'))).toBe('recomputed');
    expect(await processor.process(job('results.result-revised', 'broken'))).toBe('skipped');
    expect(synced).toEqual([raceId, raceId]);
  });
});
