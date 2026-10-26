import { readFileSync } from 'node:fs';

import type { CorridorMatch, RouteAnalysis } from '@pokatim/tracks/parse';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PARSE_LIMITS,
  PARSE_THREADS_MAX,
  type ParseFunction,
  parseThreadLoad,
  runParseThread,
} from './parse-thread';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../packages/tracks/src/__fixtures__/${name}`, import.meta.url)),
  );

describe('runParseThread', () => {
  it('функция вне белого списка — исключение до запуска потока', async () => {
    for (const fn of ['constructor', 'parseGpx', '__proto__', 'eval']) {
      await expect(runParseThread(fn as ParseFunction, [], DEFAULT_PARSE_LIMITS)).rejects.toThrow(
        /not allowed/,
      );
    }
  });

  it('analyzeRoute в потоке: результат через structured clone; отказ — код', async () => {
    const ok = await runParseThread<RouteAnalysis>(
      'analyzeRoute',
      [fixture('route-loop.gpx')],
      DEFAULT_PARSE_LIMITS,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.result.isLoop).toBe(true);

    await expect(
      runParseThread('analyzeRoute', [fixture('route-short.gpx')], DEFAULT_PARSE_LIMITS),
    ).resolves.toEqual({ ok: false, code: 'too_short' });
  });

  it('дольше лимита — timeout', async () => {
    await expect(
      runParseThread('analyzeRoute', [fixture('route-loop.gpx')], {
        ...DEFAULT_PARSE_LIMITS,
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ ok: false, code: 'timeout' });
  });

  it('analyzeAttempt в потоке: вердикт сверки; негодный коридор — corridor_invalid', async () => {
    const window = {
      startsAt: new Date('2026-06-14T05:00:00Z'),
      closesAt: new Date('2026-06-21T06:00:00Z'),
    };
    const now = new Date('2026-10-27T00:00:00Z');
    const corridor = {
      line: [
        [27.559, 53.9006],
        [27.60479122, 53.9006],
        [27.60479122, 53.94556605],
      ],
      widthM: 50,
      isLoop: false,
      distanceM: 8000,
    };
    const ok = await runParseThread<CorridorMatch>(
      'analyzeAttempt',
      [fixture('corridor/clean.gpx'), 'gpx', corridor, window, now],
      DEFAULT_PARSE_LIMITS,
    );
    expect(ok.ok && ok.result.verdict).toBe('counted');
    const overlap = { ...corridor, line: [corridor.line[0], [27.5595, 53.9006]] };
    await expect(
      runParseThread(
        'analyzeAttempt',
        [fixture('corridor/clean.gpx'), 'gpx', overlap, window, now],
        DEFAULT_PARSE_LIMITS,
      ),
    ).resolves.toEqual({ ok: false, code: 'corridor_invalid' });
  });

  it('семафор: одновременно не больше PARSE_THREADS_MAX потоков, остальные ждут (FIFO)', async () => {
    expect(PARSE_THREADS_MAX).toBe(1);
    const order: string[] = [];
    const run = (name: string) =>
      runParseThread('analyzeRoute', [fixture('route-loop.gpx')], DEFAULT_PARSE_LIMITS).then(
        (outcome) => {
          order.push(name);
          return outcome;
        },
      );
    const first = run('first');
    const second = run('second');
    const third = run('third');
    expect(parseThreadLoad()).toEqual({ active: 1, waiting: 2 });
    const outcomes = await Promise.all([first, second, third]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(parseThreadLoad()).toEqual({ active: 0, waiting: 0 });
  });
});
