import { Worker } from 'node:worker_threads';

/** Функции серверного входа `@pokatim/tracks/parse`, которые можно запустить в потоке (белый список). */
export const PARSE_FUNCTIONS = ['analyzeTrack', 'analyzeRoute'] as const;
export type ParseFunction = (typeof PARSE_FUNCTIONS)[number];

export interface ParseLimits {
  maxOldGenerationMb: number;
  maxYoungGenerationMb: number;
  timeoutMs: number;
}

/**
 * Лимиты потока разбора по умолчанию — общие для заездов (`tracks`) и маршрутов (`routes`): память старого и
 * молодого поколения (иначе V8 берёт молодое по умолчанию сверх лимита старого) и время.
 */
export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxOldGenerationMb: 160,
  maxYoungGenerationMb: 32,
  timeoutMs: 30_000,
};

/** Итог потока: результат функции или код отказа (`TrackParseError.code`, `timeout`, `unreadable`). */
export type ThreadOutcome<T> = { ok: true; result: T } | { ok: false; code: string };

/**
 * Код потока (CommonJS, `eval`): грузит серверный вход `@pokatim/tracks/parse` и вызывает функцию из белого списка
 * (имя передаёт сервер, не запрос). Отдельного файла нет: путь к нему различался бы в сборке (SWC → dist) и в тестах
 * (исходники); модуль пакета Node находит сам (в тестах — по условию `@pokatim/source` из `execArgv` vitest).
 */
const THREAD_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import('@pokatim/tracks/parse').then(
  (tracks) => {
    try {
      const result = tracks[workerData.fn](...workerData.args);
      parentPort.postMessage({ ok: true, result });
    } catch (error) {
      const code = error instanceof tracks.TrackParseError ? error.code : 'unreadable';
      parentPort.postMessage({ ok: false, code });
    }
  },
  () => parentPort.postMessage({ ok: false, code: 'loader' }),
);
`;

type ThreadMessage = { ok: true; result: unknown } | { ok: false; code: string };

/**
 * Запуск функции разбора в `worker_threads` (`AGENTS.md` §4.5, `pokatim-backend.md`): лимит памяти потока
 * (`resourceLimits`) и времени (`terminate()` по таймауту → `timeout`); исчерпание памяти → `unreadable`. Ошибка
 * загрузки модуля разбора и падение потока — не отказ файла, а сбой окружения (исключение → ретрай задачи).
 * Аргументы и результат проходят structured clone.
 */
export function runParseThread<T>(
  fn: ParseFunction,
  args: readonly unknown[],
  limits: ParseLimits,
): Promise<ThreadOutcome<T>> {
  if (!PARSE_FUNCTIONS.includes(fn)) {
    return Promise.reject(new Error(`parse function is not allowed: ${String(fn)}`));
  }
  return new Promise<ThreadOutcome<T>>((resolve, reject) => {
    const worker = new Worker(THREAD_SOURCE, {
      eval: true,
      workerData: { fn, args },
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
      () => finish(() => resolve({ ok: false, code: 'timeout' })),
      limits.timeoutMs,
    );
    worker.once('message', (message: ThreadMessage) => {
      if (message.ok) {
        finish(() => resolve({ ok: true, result: message.result as T }));
        return;
      }
      const { code } = message;
      if (code === 'loader') finish(() => reject(new Error('parser module failed to load')));
      else finish(() => resolve({ ok: false, code }));
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(() => resolve({ ok: false, code: 'unreadable' }));
      } else finish(() => reject(error));
    });
    worker.once('exit', (code) => {
      finish(() => reject(new Error(`parser thread exited with code ${code}`)));
    });
  });
}
