import { readFileSync } from 'node:fs';

import type { RouteAnalysis } from '@pokatim/tracks/parse';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PARSE_LIMITS, type ParseFunction, runParseThread } from './parse-thread';

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
});
