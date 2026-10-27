import { TRACK_FILE_MAX_BYTES, type TrackSource } from '@pokatim/contracts';

import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';
import { DEFAULT_BODY_TIMEOUTS } from '../../raw-body';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Лимиты и сроки модуля `tracks` (`[ASSUMPTION]` §7, §8.3 п. 4). */
export const TRACKS_POLICY = {
  maxFileBytes: TRACK_FILE_MAX_BYTES,
  /** Тело запроса загрузки: лимит файла + запас — 413 отдаёт сам обработчик с кодом контракта. */
  bodyLimitBytes: TRACK_FILE_MAX_BYTES + 1024 * 1024,
  uploadUserLimit: { limit: 30, windowSec: 60 * 60 },
  uploadIpLimit: { limit: 60, windowSec: 60 * 60 },
  /** Одновременных приёмов в процессе API (память): остальным — 429. */
  maxConcurrentUploads: 4,
  /** Одновременных приёмов одного пользователя (upload-limits-kml-panel): второй — 429 до чтения тела. */
  maxConcurrentUploadsPerUser: 1,
  /** Тело загрузки: тишина и всё тело — `408` (общие таймауты `src/raw-body.ts`). */
  bodyTimeouts: DEFAULT_BODY_TIMEOUTS,
  /** Кеш суммы хранимых байт (квота) в Redis. */
  usageCacheSec: 60,
  /** Разбор: память потока и время — общие лимиты `src/parse-thread.ts`. */
  parseLimits: DEFAULT_PARSE_LIMITS,
  /** Уборка: исходники отбракованных загрузок и файлы без документа. */
  rejectedRetentionMs: 7 * DAY_MS,
  orphanFileAgeMs: HOUR_MS,
  cleanupBatchSize: 200,
  /** Список своих загрузок: размер страницы по умолчанию — схема контракта. */
} as const;

/** Окно дубля (R7): |Δ старта| ≤ 180 с и |Δ длительности| ≤ 5 % (не меньше 1 с). */
export const DEDUP_START_WINDOW_MS = 180_000;
export const DEDUP_DURATION_TOLERANCE = 0.05;

export interface DedupCandidate {
  _id: string;
  source: TrackSource;
  uploadId: string;
  startedAt: Date;
  elapsedSec: number;
  hasHeartRate: boolean;
  hasPower: boolean;
  createdAt: Date;
}

/**
 * Тот же заезд с другого источника: старт в пределах 180 с, длительность в пределах 5 % (минимум 1 с). Две записи
 * одного провайдера (`garmin`/`wahoo`) — разные тренировки, не дубль (как в эталоне: объект провайдера уникален
 * по `sourceRef`); ручные загрузки сравниваются со всеми.
 */
export function isSameRide(a: DedupCandidate, b: DedupCandidate): boolean {
  if (a.source === b.source && a.source !== 'upload') return false;
  if (Math.abs(a.startedAt.getTime() - b.startedAt.getTime()) > DEDUP_START_WINDOW_MS) return false;
  const tolerance = Math.max(a.elapsedSec * DEDUP_DURATION_TOLERANCE, 1);
  return Math.abs(a.elapsedSec - b.elapsedSec) <= tolerance;
}

const SOURCE_RANK: Record<TrackSource, number> = { upload: 0, garmin: 1, wahoo: 2 };

/** Члены группы дублей в порядке приоритета основной (`pickPrimary` — первый). */
export function byPrimaryPriority<T extends DedupCandidate>(group: readonly T[]): T[] {
  return [...group].sort(
    (a, b) =>
      Number(b.hasPower) - Number(a.hasPower) ||
      Number(b.hasHeartRate) - Number(a.hasHeartRate) ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a._id.localeCompare(b._id),
  );
}

/**
 * Основная активность группы дублей (R7): с мощностью > с пульсом > ручная загрузка > Garmin > Wahoo > раньше
 * созданная (затем `_id` — детерминированно).
 */
export function pickPrimary<T extends DedupCandidate>(group: readonly T[]): T {
  const primary = byPrimaryPriority(group)[0];
  if (!primary) throw new Error('empty dedup group');
  return primary;
}
