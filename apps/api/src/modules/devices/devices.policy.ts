import type { DeviceProvider } from '@pokatim/contracts';
import { AGGREGATOR_CYCLING_TYPES, TRACK_STREAM_MAX_POINTS } from '@pokatim/tracks';

import type { DeviceConnectionDoc } from './devices.collection';
import type { AggregatorWindow, AggregatorWorkout } from './wearables-aggregator';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Правила модуля `devices` (`[ASSUMPTION]` — лимиты и интервалы §7, §8.3 п. 4). */
export const DEVICES_POLICY = {
  /** Одноразовый тикет активации подключения (R4). */
  ticketTtlMs: 30 * MINUTE,
  /** Первые 48 ч после подключения pull берёт полное окно истории (историческая выгрузка OW асинхронна). */
  catchUpMs: 48 * HOUR,
  /** Инкрементальное окно — от `lastSyncedAt` минус сутки (поздно пришедшие тренировки). */
  incrementalOverlapMs: DAY,
  /** Тренировка длиннее — не импортируется (как правдоподобие `tracks`). */
  maxWorkoutMs: 48 * HOUR,
  /** Попыток импорта одной тренировки; затем — `issue: 'sync_failed'`. */
  maxImportAttempts: 5,
  maxTrackPoints: TRACK_STREAM_MAX_POINTS,
  connectLimit: { limit: 10, windowSec: 3600 },
  syncLimit: { limit: 1, windowSec: 600 },
  webhookIpLimit: { limit: 600, windowSec: 60 },
  /** Кеш каталога провайдеров агрегатора (Redis). */
  providersCacheSec: 300,
  /** «Синхронизировать сейчас»: OW тянет у провайдера асинхронно — pull через 30 с и ещё через 3 мин. */
  syncFollowUpDelaysMs: [30_000, 3 * MINUTE] as const,
  /** Замок создания пользователя агрегатора (`devices:account:<userId>`) и ожидание его освобождения. */
  accountLockTtlMs: 30_000,
  accountLockWaitMs: 20_000,
  /** Замок pull одного подключения: расписание, «сейчас» и вебхук не тянут его параллельно. */
  pullLockTtlMs: 10 * MINUTE,
  /**
   * Отзыв берёт тот же замок (`devices:pull:<id>`) и ждёт текущий импорт; не дождался — повтор задачи. Последняя
   * попытка ждёт весь TTL замка pull (замок истекает сам).
   */
  revokeLockWaitMs: 30_000,
  /** Тело вебхука Svix (подпись — по сырым байтам). */
  webhookMaxBytes: 256 * 1024,
  /** Уборка неподтверждённых подключений и пачки регламентных задач. */
  cleanupEveryMs: 10 * MINUTE,
  batchSize: 100,
} as const;

const CYCLING = new Set(AGGREGATOR_CYCLING_TYPES.map((type) => type.toLowerCase()));

/**
 * Окно pull: первые 48 ч после подключения и до первой синхронизации — вся история (`historyDays`), дальше — от
 * `lastSyncedAt` минус сутки.
 */
export function pullWindow(
  connection: Pick<DeviceConnectionDoc, 'lastSyncedAt' | 'catchUpUntil'>,
  now: Date,
  historyDays: number,
): AggregatorWindow {
  const full = new Date(now.getTime() - historyDays * DAY);
  const catchingUp = connection.catchUpUntil !== null && now < connection.catchUpUntil;
  if (catchingUp || connection.lastSyncedAt === null) return { from: full, to: now };
  const incremental = new Date(
    connection.lastSyncedAt.getTime() - DEVICES_POLICY.incrementalOverlapMs,
  );
  return { from: incremental < full ? full : incremental, to: now };
}

export type ImportDecision =
  { kind: 'import'; end: Date } | { kind: 'ignore' } | { kind: 'skip'; reason: string };

/**
 * Что делать с тренировкой агрегатора: не велотип или чужой провайдер — `ignore` (без записи импорта); длиннее 48 ч
 * или без конца — `skip` (запись со статусом `skipped`, не повторяется); иначе — импорт трека за `[start, end]`.
 */
export function importDecision(
  workout: AggregatorWorkout,
  provider: DeviceProvider,
): ImportDecision {
  if (!CYCLING.has(workout.type.toLowerCase())) return { kind: 'ignore' };
  if (workout.provider !== provider) return { kind: 'ignore' };
  const end =
    workout.endedAt ??
    (workout.durationSec !== null
      ? new Date(workout.startedAt.getTime() + workout.durationSec * 1000)
      : null);
  if (!end || end <= workout.startedAt) return { kind: 'skip', reason: 'no_track' };
  if (end.getTime() - workout.startedAt.getTime() > DEVICES_POLICY.maxWorkoutMs) {
    return { kind: 'skip', reason: 'too_long' };
  }
  return { kind: 'import', end };
}

/**
 * `returnUrl` клиента — только из allowlist `DEVICE_RETURN_URLS` (точный префикс): совпадение целиком или
 * продолжение после `?`, `#`, `/` (элемент allowlist, оканчивающийся на `/` или `://`, — префикс как есть). Без
 * пробелов и управляющих символов.
 */
export function isAllowedReturnUrl(returnUrl: string, allowlist: readonly string[]): boolean {
  if (
    /[\s\\]/.test(returnUrl) ||
    [...returnUrl].some((char) => char.charCodeAt(0) < 0x20 || char === '\u007f')
  ) {
    return false;
  }
  return allowlist.some((allowed) => {
    if (returnUrl === allowed) return true;
    if (!returnUrl.startsWith(allowed)) return false;
    return allowed.endsWith('/') || /^[?#/]/.test(returnUrl.slice(allowed.length));
  });
}

/** Внешний id пользователя pokatim в агрегаторе: без ПДн (§8.3 п. 3). */
export const aggregatorExternalId = (prefix: string, userId: string) => `${prefix}${userId}`;
