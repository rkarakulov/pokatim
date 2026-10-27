import { readFileSync } from 'node:fs';

import type { CorridorMatch, RouteAnalysis, RouteDerived } from '@pokatim/tracks/parse';
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

  it('deriveRoute в потоке (routes-03): профиль и GPX через structured clone; отказ — код', async () => {
    const ok = await runParseThread<RouteDerived>(
      'deriveRoute',
      [fixture('route-loop.gpx')],
      DEFAULT_PARSE_LIMITS,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.result.profile![0]![0]).toBe(0);
      expect(ok.result.gpx).toContain('creator="Pokatim"');
    }
    await expect(
      runParseThread('deriveRoute', [fixture('xxe.gpx')], DEFAULT_PARSE_LIMITS),
    ).resolves.toEqual({ ok: false, code: 'unreadable' });
  });

  it('analyzeRoute KML в потоке (routes-02): My Maps и gx:Track — результат; billion laughs — unreadable', async () => {
    for (const name of ['route-mymaps.kml', 'route-earth-gxtrack.kml']) {
      const outcome = await runParseThread<RouteAnalysis>(
        'analyzeRoute',
        [fixture(name)],
        DEFAULT_PARSE_LIMITS,
      );
      expect(outcome.ok, name).toBe(true);
    }
    await expect(
      runParseThread('analyzeRoute', [fixture('billion-laughs.kml')], DEFAULT_PARSE_LIMITS),
    ).resolves.toEqual({ ok: false, code: 'unreadable' });
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
    expect(parseThreadLoad()).toMatchObject({ active: 1, waiting: 2 });
    const outcomes = await Promise.all([first, second, third]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(parseThreadLoad()).toMatchObject({ active: 0, waiting: 0, live: 0 });
  });

  it('слот освобождается после завершения потока: живых потоков не больше одного', async () => {
    const run = (limits = DEFAULT_PARSE_LIMITS) =>
      runParseThread('analyzeRoute', [fixture('route-loop.gpx')], limits);
    // успех, таймаут (terminate) и снова успех — следующий поток не создаётся, пока прежний жив
    await Promise.all([run(), run({ ...DEFAULT_PARSE_LIMITS, timeoutMs: 1 }), run()]);
    expect(parseThreadLoad()).toEqual({ active: 0, waiting: 0, live: 0, peak: PARSE_THREADS_MAX });
  });
});
