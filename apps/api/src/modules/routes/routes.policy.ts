import {
  MY_ROUTE_MAX_COUNT,
  ROUTE_FILE_MAX_BYTES,
  type RouteDistanceBucket,
} from '@pokatim/contracts';

import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';
import { DEFAULT_BODY_TIMEOUTS } from '../../raw-body';

/** Лимиты модуля `routes` (`[ASSUMPTION]` race-results-01 §7, §8.3). */
export const ROUTE_POLICY = {
  maxFileBytes: ROUTE_FILE_MAX_BYTES,
  /** Загрузок на сотрудника в час. */
  uploadUserLimit: { limit: 20, windowSec: 60 * 60 },
  /** Мои маршруты (routes-02, RC-5): загрузок на райдера и на IP в час — до чтения тела. */
  riderUploadUserLimit: { limit: 20, windowSec: 60 * 60 },
  riderUploadIpLimit: { limit: 60, windowSec: 60 * 60 },
  /** Одновременных приёмов райдеров в процессе API (тело до 5 МиБ в памяти): остальным — 429. */
  riderMaxConcurrentUploads: 4,
  /** Одновременных приёмов одного райдера (upload-limits-kml-panel): второй — 429 до чтения тела. */
  riderMaxConcurrentUploadsPerUser: 1,
  /** Тело загрузки (панель и «мои»): тишина и всё тело — `408` (общие таймауты `src/raw-body.ts`). */
  bodyTimeouts: DEFAULT_BODY_TIMEOUTS,
  /** Квота своих маршрутов райдера (все статусы): больше — `409 ROUTE_QUOTA_EXCEEDED`. */
  riderMaxRoutes: MY_ROUTE_MAX_COUNT,
  /**
   * Обработка дольше — считается зависшей (все попытки BullMQ с бэкоффом укладываются в минуты; запись отказа
   * последней попытки могла не пройти): повторная загрузка того же файла возвращает маршрут в обработку.
   */
  stuckAfterMs: 15 * 60 * 1000,
  /** Разбор: память потока и время — общие лимиты `src/parse-thread.ts`. */
  parseLimits: DEFAULT_PARSE_LIMITS,
} as const;

/**
 * Корзины дистанции каталога (routes-01 §7), метры: `lt50` < 50 000, `50to100` — [50 000; 100 000], `gt100` > 100 000.
 * Значение — условие MongoDB на `distanceM` (только репозиторий).
 */
export const ROUTE_DISTANCE_RANGES_M: Record<
  RouteDistanceBucket,
  { $gt?: number; $gte?: number; $lt?: number; $lte?: number }
> = {
  lt50: { $lt: 50_000 },
  '50to100': { $gte: 50_000, $lte: 100_000 },
  gt100: { $gt: 100_000 },
};
