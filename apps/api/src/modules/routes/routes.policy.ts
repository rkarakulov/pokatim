import { ROUTE_FILE_MAX_BYTES } from '@pokatim/contracts';

import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';

/** Лимиты модуля `routes` (`[ASSUMPTION]` race-results-01 §7, §8.3). */
export const ROUTE_POLICY = {
  maxFileBytes: ROUTE_FILE_MAX_BYTES,
  /** Загрузок на сотрудника в час. */
  uploadUserLimit: { limit: 20, windowSec: 60 * 60 },
  /** Разбор: память потока и время — общие лимиты `src/parse-thread.ts`. */
  parseLimits: DEFAULT_PARSE_LIMITS,
} as const;
