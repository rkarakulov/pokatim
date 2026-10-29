import type { RateLimitedDetails } from '@pokatim/contracts';
import type { RateLimiter, RateLimitRule } from '@rkarakulov/api-kit/core';

import { domainError } from './error-messages';

/**
 * Лимит частоты действия пользователя (`RateLimiter` базы, ключ — `<действие>:<uid>` или `<действие>:<сессия>`):
 * отказ — `429 RATE_LIMITED { retryAfterSec }` (`Retry-After` ставит фильтр ошибок). Общий для модулей API
 * (композиция, как `public-read.guard.ts`).
 */
export async function consumeUserLimit(
  rateLimiter: RateLimiter,
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<void> {
  const result = await rateLimiter.consume(key, rule, now);
  if (!result.allowed) {
    const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
    throw domainError('RATE_LIMITED', 429, details);
  }
}
