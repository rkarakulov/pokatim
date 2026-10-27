import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RegisterPushToken, RevokePushToken } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { consumeUserLimit } from './notifications.service';

/**
 * Push-токены устройства (ADR-0017): регистрация и снятие — общий лимит `notifications-push-token` по `uid`. Токен
 * чужого аккаунта переходит к вошедшему (устройство одно); снятие чужого или неизвестного — тот же `204` без эффекта.
 * Токены в логи не попадают.
 */
@Injectable()
export class PushTokensService {
  private readonly logger = new Logger(PushTokensService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Токен привязан к сессии запроса (`sessionId` из `AuthGuard`): push уходит, только пока она жива. */
  async register(userId: string, sessionId: string, body: RegisterPushToken): Promise<void> {
    const now = this.clock.now();
    await this.limit(userId, now);
    await this.repository.registerToken(
      userId,
      sessionId,
      body.token,
      body.platform,
      now,
      NOTIFICATIONS_POLICY.maxTokensPerUser,
    );
    this.logger.log(`notifications.token_registered uid=${userId} platform=${body.platform}`);
  }

  async revoke(userId: string, body: RevokePushToken): Promise<void> {
    await this.limit(userId, this.clock.now());
    const revoked = await this.repository.revokeToken(userId, body.token);
    this.logger.log(`notifications.token_revoked uid=${userId} count=${revoked}`);
  }

  private limit(userId: string, now: Date): Promise<void> {
    return consumeUserLimit(
      this.rateLimiter,
      `notifications-push-token:${userId}`,
      NOTIFICATIONS_POLICY.pushTokenLimit,
      now,
    );
  }
}
