import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from './config/env';
import { domainError } from './error-messages';
import { rateLimitKeyForIp } from './modules/identity';

/** IP-лимит публичного чтения (`[ASSUMPTION]` 300 запросов в минуту с адреса; IPv6 — по сети /64). */
export const PUBLIC_READ_LIMIT = { limit: 300, windowSec: 60 } as const;

/** Кэш публичного чтения: ответы одинаковы для всех, фаза меняется с задержкой до минуты (риск §8). */
export const PUBLIC_READ_CACHE_CONTROL = 'public, max-age=60';

/** Лимит частоты: запросов за окно, с. */
export interface IpLimit {
  limit: number;
  windowSec: number;
}

/**
 * Списать запрос с IP-лимита `name` (ключ `<name>:<HMAC адреса>`, в Redis нет IP); превышение —
 * `429 RATE_LIMITED` с `retryAfterSec` (`Retry-After` ставит фильтр ошибок).
 */
export async function consumeIpLimit(
  limiter: RateLimiter,
  secret: string,
  clock: Clock,
  ip: string,
  name: string,
  limit: IpLimit,
): Promise<void> {
  const key = `${name}:${rateLimitKeyForIp(secret, ip)}`;
  const result = await limiter.consume(key, limit, clock.now());
  if (!result.allowed) {
    const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
    throw domainError('RATE_LIMITED', 429, details);
  }
}

/**
 * Публичное чтение без входа (Q14: `/v1/races`, `/v1/seasons`, `/v1/calendar`): только IP-лимит `public-read`
 * (429 + `Retry-After`), ключ — HMAC адреса, как у лимитов identity (в Redis нет IP). Общий для модулей `races` и
 * `calendar` — композиция, как `page-cursor.ts`.
 */
@Injectable()
export class PublicReadGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'RATE_LIMIT_KEY_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ip } = context.switchToHttp().getRequest<{ ip: string }>();
    await consumeIpLimit(
      this.rateLimiter,
      this.env.RATE_LIMIT_KEY_SECRET,
      this.clock,
      ip,
      'public-read',
      PUBLIC_READ_LIMIT,
    );
    return true;
  }
}

const IP_RATE_LIMIT = 'pokatim:ip-rate-limit';

/**
 * Отдельный IP-лимит метода (routes-03: `route-gpx` — общий бюджет скачивания файлов маршрута GPX/KML/TCX,
 * routes-formats) — вместе с `@UseGuards(IpRateLimitGuard)`.
 */
export const IpRateLimit = (name: string, limit: IpLimit) =>
  SetMetadata(IP_RATE_LIMIT, { name, limit });

/**
 * IP-лимит метода по метаданным `@IpRateLimit(name, limit)` (после класс-гарда `PublicReadGuard`, до БД). Нет
 * метаданных — ошибка конфигурации.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'RATE_LIMIT_KEY_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<{ name: string; limit: IpLimit } | undefined>(
      IP_RATE_LIMIT,
      context.getHandler(),
    );
    if (!meta) throw new Error('IpRateLimitGuard без @IpRateLimit(name, limit)');
    const { ip } = context.switchToHttp().getRequest<{ ip: string }>();
    await consumeIpLimit(
      this.rateLimiter,
      this.env.RATE_LIMIT_KEY_SECRET,
      this.clock,
      ip,
      meta.name,
      meta.limit,
    );
    return true;
  }
}
