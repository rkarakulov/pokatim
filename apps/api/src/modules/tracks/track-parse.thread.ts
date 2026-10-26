import type { TrackFailureCode, TrackFormat } from '@pokatim/contracts';
import type { TrackAnalysis } from '@pokatim/tracks/parse';

import { type ParseLimits, runParseThread } from '../../parse-thread';

export type { ParseLimits } from '../../parse-thread';

export type ParseOutcome =
  { ok: true; analysis: TrackAnalysis } | { ok: false; failure: TrackFailureCode };

/**
 * Разбор исходника заезда в `worker_threads` с лимитами (`src/parse-thread.ts`): `analyzeTrack` → итог или код
 * отказа; таймаут — `timeout`, исчерпание памяти — `unreadable`; сбой окружения — исключение (ретрай задачи).
 */
export async function analyzeInThread(
  bytes: Uint8Array,
  format: TrackFormat,
  now: Date,
  limits: ParseLimits,
): Promise<ParseOutcome> {
  const outcome = await runParseThread<TrackAnalysis>('analyzeTrack', [bytes, format, now], limits);
  return outcome.ok
    ? { ok: true, analysis: outcome.result }
    : { ok: false, failure: outcome.code as TrackFailureCode };
}
