import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  RegisterPushToken,
  RegisterWebPushSubscription,
  RevokePushToken,
  RevokeWebPushSubscription,
  WebPushConfig,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import { type Env, webPushVapid } from '../../config/env';

import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { consumeUserLimit } from '../../user-limit';

/**
 * Push-токены устройства (ADR-0017) и подписки Web Push (ADR-0022): регистрация и снятие — общий лимит
 * `notifications-push-token` по `uid`. Токен (endpoint) чужого аккаунта переходит к вошедшему (устройство одно), но
 * не от более новой сессии к прежней (поздняя регистрация после выхода);
 * снятие чужого или неизвестного — тот же `204` без эффекта. Токены, endpoint и ключи в логи не попадают.
 */
@Injectable()
export class PushTokensService {
  private readonly logger = new Logger(PushTokensService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV)
    private readonly env: Pick<
      Env,
      'WEB_PUSH_ENABLED' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'
    >,
  ) {}

  /** Публичный ключ VAPID для `pushManager.subscribe`; Web Push выключен — `null` (опции в приложении нет). */
  webPushConfig(): WebPushConfig {
    return { publicKey: webPushVapid(this.env)?.publicKey ?? null };
  }

  /**
   * Подписка Web Push этого браузера — как токен устройства: upsert по endpoint, владелец и сессия — из `AuthGuard`.
   * Подписка принимается и при выключенном Web Push (доставка её не тронет): включение не требует переподписки.
   */
  async registerWeb(
    userId: string,
    sessionId: string,
    body: RegisterWebPushSubscription,
  ): Promise<void> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const registered = await this.repository.registerToken(
      userId,
      sessionId,
      { token: body.endpoint, platform: 'web', webPush: body.keys },
      now,
      NOTIFICATIONS_POLICY.maxTokensPerUser,
    );
    this.logRegistration(userId, 'web', registered);
  }

  async revokeWeb(userId: string, body: RevokeWebPushSubscription): Promise<void> {
    await this.limit(userId, this.clock.now());
    const revoked = await this.repository.revokeToken(userId, body.endpoint);
    this.logger.log(`notifications.token_revoked uid=${userId} platform=web count=${revoked}`);
  }

  /** Токен привязан к сессии запроса (`sessionId` из `AuthGuard`): push уходит, только пока она жива. */
  async register(userId: string, sessionId: string, body: RegisterPushToken): Promise<void> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const registered = await this.repository.registerToken(
      userId,
      sessionId,
      { token: body.token, platform: body.platform },
      now,
      NOTIFICATIONS_POLICY.maxTokensPerUser,
    );
    this.logRegistration(userId, body.platform, registered);
  }

  async revoke(userId: string, body: RevokePushToken): Promise<void> {
    await this.limit(userId, this.clock.now());
    const revoked = await this.repository.revokeToken(userId, body.token);
    this.logger.log(`notifications.token_revoked uid=${userId} count=${revoked}`);
  }

  /** Устаревшая регистрация (токен уже у более новой сессии устройства) — тот же `204`, без записи. */
  private logRegistration(userId: string, platform: string, registered: boolean): void {
    const event = registered ? 'token_registered' : 'token_stale';
    this.logger.log(`notifications.${event} uid=${userId} platform=${platform}`);
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
