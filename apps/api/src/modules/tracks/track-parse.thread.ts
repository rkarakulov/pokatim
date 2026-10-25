import { Worker } from 'node:worker_threads';

import type { TrackFailureCode, TrackFormat } from '@pokatim/contracts';
import type { TrackAnalysis } from '@pokatim/tracks/parse';

/**
 * Код потока разбора (CommonJS, `eval`): грузит серверный вход `@pokatim/tracks/parse` и отдаёт результат
 * `analyzeTrack` или код отказа. Отдельного файла нет: путь к нему различался бы в сборке (SWC → dist) и в тестах
 * (исходники); модуль пакета Node находит сам (в тестах — по условию `@pokatim/source` из `execArgv` vitest).
 */
const THREAD_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import('@pokatim/tracks/parse').then(
  (tracks) => {
    try {
      const result = tracks.analyzeTrack(workerData.bytes, workerData.format, new Date(workerData.now));
      parentPort.postMessage({ ok: true, result });
    } catch (error) {
      const code = error instanceof tracks.TrackParseError ? error.code : 'unreadable';
      parentPort.postMessage({ ok: false, code });
    }
  },
  () => parentPort.postMessage({ ok: false, code: 'loader' }),
);
`;

export type ParseOutcome =
  { ok: true; analysis: TrackAnalysis } | { ok: false; failure: TrackFailureCode };

type ThreadMessage =
  { ok: true; result: TrackAnalysis } | { ok: false; code: TrackFailureCode | 'loader' };

export interface ParseLimits {
  maxOldGenerationMb: number;
  maxYoungGenerationMb: number;
  timeoutMs: number;
}

/**
 * Разбор исходника в `worker_threads` (§7, `pokatim-backend.md`): лимит памяти потока (`resourceLimits`) и времени
 * (`terminate()` по таймауту → `timeout`); исчерпание памяти потока → `unreadable`. Ошибка загрузки модуля
 * разбора — не отказ файла, а сбой окружения (исключение → ретрай задачи).
 */
export function analyzeInThread(
  bytes: Uint8Array,
  format: TrackFormat,
  now: Date,
  limits: ParseLimits,
): Promise<ParseOutcome> {
  return new Promise<ParseOutcome>((resolve, reject) => {
    const worker = new Worker(THREAD_SOURCE, {
      eval: true,
      workerData: { bytes, format, now: now.getTime() },
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxOldGenerationMb,
        maxYoungGenerationSizeMb: limits.maxYoungGenerationMb,
      },
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
      void worker.terminate();
    };
    const timer = setTimeout(
      () => finish(() => resolve({ ok: false, failure: 'timeout' })),
      limits.timeoutMs,
    );
    worker.once('message', (message: ThreadMessage) => {
      if (message.ok) {
        finish(() => resolve({ ok: true, analysis: message.result }));
        return;
      }
      const { code } = message;
      if (code === 'loader') finish(() => reject(new Error('track parser module failed to load')));
      else finish(() => resolve({ ok: false, failure: code }));
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(() => resolve({ ok: false, failure: 'unreadable' }));
      } else finish(() => reject(error));
    });
    worker.once('exit', (code) => {
      finish(() => reject(new Error(`track parser thread exited with code ${code}`)));
    });
  });
}
