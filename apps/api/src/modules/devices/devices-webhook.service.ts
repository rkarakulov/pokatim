import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { rateLimitKeyForIp } from '../identity';
import { DevicesPullQueue } from './devices-jobs';
import { DEVICES_POLICY } from './devices.policy';
import { DevicesRepository } from './devices.repository';
import { WEARABLES_AGGREGATOR, type WearablesAggregator } from './wearables-aggregator';

const SVIX_HEADERS = ['svix-id', 'svix-timestamp', 'svix-signature'] as const;

/**
 * Вебхук агрегатора (R5, ускоритель pull): без `OW_WEBHOOK_SECRET` — 404 (push выключен); IP-лимит 600/мин (ключ —
 * HMAC адреса); подпись Svix по сырым байтам тела — неверная или старая метка — 401 без записи и без лога тела. Из
 * тела берётся только `user_id`: своё активное подключение — pull (дедупликация задачи), неизвестный (в том числе
 * чужой пользователь общего инстанса) — 200 без записи и лога. Данные тренировок из тела не используются.
 */
@Injectable()
export class DevicesWebhookService {
  constructor(
    private readonly repository: DevicesRepository,
    private readonly pulls: DevicesPullQueue,
    private readonly rateLimiter: RateLimiter,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async receive(
    rawHeaders: Record<string, string | string[] | undefined>,
    rawBody: Buffer | undefined,
    ip: string,
  ): Promise<void> {
    if (!this.env.DEVICES_ENABLED || !this.env.OW_WEBHOOK_SECRET)
      throw domainError('NOT_FOUND', 404);
    const limit = await this.rateLimiter.consume(
      `devices-webhook:${rateLimitKeyForIp(this.env.RATE_LIMIT_KEY_SECRET, ip)}`,
      DEVICES_POLICY.webhookIpLimit,
      this.clock.now(),
    );
    if (!limit.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limit.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    if (!rawBody) throw domainError('UNAUTHORIZED', 401);
    const headers: Record<string, string | undefined> = {};
    for (const name of SVIX_HEADERS) {
      const value = rawHeaders[name];
      headers[name] = typeof value === 'string' ? value : undefined;
    }

    let aggUserId: string | null;
    try {
      aggUserId = this.aggregator.verifyWebhook(headers, rawBody).aggUserId;
    } catch {
      throw domainError('UNAUTHORIZED', 401);
    }
    if (!aggUserId) return;
    for (const connection of await this.repository.listActiveByAggUser(aggUserId)) {
      await this.pulls.schedule(connection._id, 'webhook');
    }
  }
}
