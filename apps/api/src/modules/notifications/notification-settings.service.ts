import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { consumeUserLimit } from './notifications.service';

/**
 * Настройки уведомлений (N4, N6): нет документа — умолчания; `PUT` — полная замена после zod (`start ≠ end` проверяет
 * контракт). Не ретроактивны (RC-13): уже созданные уведомления центра не трогаются.
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string): Promise<NotificationSettings> {
    return (await this.repository.findSettings(userId)) ?? DEFAULT_NOTIFICATION_SETTINGS;
  }

  async put(userId: string, settings: NotificationSettings): Promise<NotificationSettings> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `notifications-settings:${userId}`,
      NOTIFICATIONS_POLICY.settingsLimit,
      now,
    );
    await this.repository.saveSettings(userId, settings, now);
    return settings;
  }
}
