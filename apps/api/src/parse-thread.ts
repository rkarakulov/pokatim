import { Worker } from 'node:worker_threads';

/**
 * Функции серверного входа `@pokatim/tracks/parse`, которые можно запустить в потоке (белый список, новые — в конец).
 * `analyzeSections` — участки маршрута (route-rides-05): второй вызов потока после основной сверки заезда.
 */
export const PARSE_FUNCTIONS = [
  'analyzeTrack',
  'analyzeRoute',
  'analyzeAttempt',
  'analyzeSeries',
  'deriveRoute',
  'analyzeSections',
] as const;
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

/**
 * Потоков разбора одновременно на процесс (R4 race-results-03): track-processing, route-processing, attempt-check,
 * dispute-series и routes-maintenance (бэкфилл производных маршрута, routes-03) не
 * держат несколько потоков по 160 + 32 МБ в worker с лимитом 512 МиБ. Поднять — вместе с лимитом контейнера.
 */
export const PARSE_THREADS_MAX = 1;

let activeThreads = 0;
/** Потоков, ещё не завершившихся (событие `exit`): слот семафора держится до него. */
let liveThreads = 0;
let peakLiveThreads = 0;
const waiting: (() => void)[] = [];

/** Семафор потоков (FIFO). Свободный слот берётся синхронно; ожидание не входит в таймаут потока. */
function acquireThread(): Promise<void> {
  if (activeThreads < PARSE_THREADS_MAX) {
    activeThreads += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseThread(): void {
  const next = waiting.shift();
  if (next) next();
  else activeThreads -= 1;
}

/** Нагрузка семафора (тесты, логи): слоты в работе, вызовы в ожидании, живые потоки и их максимум за процесс. */
export function parseThreadLoad(): { active: number; waiting: number; live: number; peak: number } {
  return {
    active: activeThreads,
    waiting: waiting.length,
    live: liveThreads,
    peak: peakLiveThreads,
  };
}

/**
 * Итог потока: результат функции или код отказа (`TrackParseError.code`, `corridor_invalid` — `CorridorError`,
 * `timeout`, `unreadable`).
 */
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
      const code =
        error instanceof tracks.TrackParseError
          ? error.code
          : error instanceof tracks.CorridorError
            ? 'corridor_invalid'
            : 'unreadable';
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
 * Аргументы и результат проходят structured clone. Одновременно — не больше `PARSE_THREADS_MAX` потоков на процесс
 * (очередь FIFO; ожидание слота не входит в `timeoutMs`).
 */
export async function runParseThread<T>(
  fn: ParseFunction,
  args: readonly unknown[],
  limits: ParseLimits,
): Promise<ThreadOutcome<T>> {
  if (!PARSE_FUNCTIONS.includes(fn)) {
    throw new Error(`parse function is not allowed: ${String(fn)}`);
  }
  await acquireThread();
  try {
    return await startThread<T>(fn, args, limits);
  } finally {
    releaseThread();
  }
}

function startThread<T>(
  fn: ParseFunction,
  args: readonly unknown[],
  limits: ParseLimits,
): Promise<ThreadOutcome<T>> {
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
    liveThreads += 1;
    peakLiveThreads = Math.max(peakLiveThreads, liveThreads);
    const exited = new Promise<void>((done) =>
      worker.once('exit', () => {
        liveThreads -= 1;
        done();
      }),
    );
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // итог — после завершения потока: слот семафора не освобождается, пока поток держит память
      void worker.terminate();
      void exited.then(action);
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
