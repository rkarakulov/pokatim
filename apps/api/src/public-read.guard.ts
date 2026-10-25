import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from './config/env';
import { domainError } from './error-messages';
import { rateLimitKeyForIp } from './modules/identity';

/** IP-лимит публичного чтения (`[ASSUMPTION]` 300 запросов в минуту с адреса; IPv6 — по сети /64). */
export const PUBLIC_READ_LIMIT = { limit: 300, windowSec: 60 } as const;

/** Кэш публичного чтения: ответы одинаковы для всех, фаза меняется с задержкой до минуты (риск §8). */
export const PUBLIC_READ_CACHE_CONTROL = 'public, max-age=60';

/**
 * Публичное чтение без входа (Q14: `/v1/races`, `/v1/seasons`, `/v1/calendar`): только IP-лимит `public-read`
 * (429 + `Retry-After`), ключ — HMAC адреса, как у лимитов identity (в Redis нет IP). Общий для модулей `races` и
 * `calendar` — композиция, как `page-cursor.ts`.
 */
@Injectable()
export class PublicReadGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ip } = context.switchToHttp().getRequest<{ ip: string }>();
    const key = `public-read:${rateLimitKeyForIp(this.env.EMAIL_TOKEN_SECRET, ip)}`;
    const result = await this.rateLimiter.consume(key, PUBLIC_READ_LIMIT, this.clock.now());
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    return true;
  }
}
