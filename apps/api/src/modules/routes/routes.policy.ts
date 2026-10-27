import {
  MY_ROUTE_MAX_COUNT,
  ROUTE_FILE_MAX_BYTES,
  type RouteDistanceBucket,
} from '@pokatim/contracts';

import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';

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
  /** Квота своих маршрутов райдера (все статусы): больше — `409 ROUTE_QUOTA_EXCEEDED`. */
  riderMaxRoutes: MY_ROUTE_MAX_COUNT,
  /**
   * Обработка дольше — считается зависшей (все попытки BullMQ с бэкоффом укладываются в минуты; запись отказа
   * последней попытки могла не пройти): повторная загрузка того же файла возвращает маршрут в обработку.
   */
  stuckAfterMs: 15 * 60 * 1000,
  /** Разбор: память потока и время — общие лимиты `src/parse-thread.ts`. */
  parseLimits: DEFAULT_PARSE_LIMITS,
  /** Скачиваний очищенного GPX каталога с IP в минуту (`[ASSUMPTION]` A2 routes-03). */
  gpxIpLimit: { limit: 30, windowSec: 60 },
  /** Маршрутов за прогон бэкфилла производных (`routes-maintenance`); полная пачка ставит продолжение. */
  deriveBatch: 20,
} as const;

/** Предел имени файла GPX, кодовых точек (без `.gpx`). */
const GPX_FILE_NAME_MAX = 80;
/** Имя файла по умолчанию (пустое название) и ASCII-fallback `filename=`. */
const GPX_FILE_NAME_FALLBACK = 'pokatim-route';

/**
 * Безопасное имя файла GPX из названия маршрута (routes-03 §7, RC-14), без `.gpx`: удаляются управляющие и
 * форматирующие символы (`\p{Cc}`, `\p{Cf}` — в т. ч. bidi `U+202E`, подмена расширения) и `\/:*?"<>|`, пробелы
 * схлопываются, точки и пробелы по краям обрезаются, ≤ 80 кодовых точек (суррогатная пара не режется); пусто —
 * `pokatim-route`.
 */
export function gpxFileName(title: string): string {
  const cleaned = title
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  const name = Array.from(cleaned)
    .slice(0, GPX_FILE_NAME_MAX)
    .join('')
    .replace(/[\s.]+$/u, '');
  return name === '' ? GPX_FILE_NAME_FALLBACK : name;
}

/** RFC 5987: `encodeURIComponent` + `'()*` → `%XX`. */
const rfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** `Content-Disposition` скачивания GPX: ASCII-fallback и имя из названия (RFC 5987). */
export function gpxContentDisposition(title: string): string {
  return `attachment; filename="${GPX_FILE_NAME_FALLBACK}.gpx"; filename*=UTF-8''${rfc5987(`${gpxFileName(title)}.gpx`)}`;
}

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
