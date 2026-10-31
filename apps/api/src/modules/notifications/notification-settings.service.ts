import { Inject, Injectable } from '@nestjs/common';
import type {
  AchievementNotificationSettingsView,
  EventNotificationSettingsView,
  NotificationSettings,
  RouteNotificationSettingsView,
  SocialNotificationSettingsView,
  UpdateAchievementNotificationSettings,
  UpdateEventNotificationSettings,
  UpdateRouteNotificationSettings,
  UpdateSocialNotificationSettings,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { DEFAULT_DELIVERY_SETTINGS, NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { consumeUserLimit } from '../../user-limit';

/**
 * Настройки уведомлений (N4, N6): нет документа — умолчания; `PUT` — полная замена формы после zod (`start ≠ end`
 * проверяет контракт). Группы «Мероприятия», «Маршруты», «Достижения» и «Свои» — отдельные подресурсы (RC-D1): ответ `/settings` — ровно
 * прежние ключи, его `PUT` их тумблеры не стирает. «Маршруты» без сохранённого тумблера — значение «Райдов». Лимит —
 * общий. Не ретроактивны (RC-13): уже созданные уведомления центра не трогаются.
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string): Promise<NotificationSettings> {
    const { push, email, quietHours } = await this.current(userId);
    return {
      push: { races: push.races, disputes: push.disputes, rides: push.rides },
      email: { disputes: email.disputes, rides: email.rides },
      quietHours,
    };
  }

  async put(userId: string, settings: NotificationSettings): Promise<NotificationSettings> {
    const now = await this.consume(userId);
    await this.repository.saveSettings(userId, settings, now);
    return settings;
  }

  async getEvents(userId: string): Promise<EventNotificationSettingsView> {
    const { push, email } = await this.current(userId);
    return { push: push.events, email: email.events };
  }

  async putEvents(
    userId: string,
    body: UpdateEventNotificationSettings,
  ): Promise<EventNotificationSettingsView> {
    const now = await this.consume(userId);
    await this.repository.saveEventSettings(userId, body, now);
    return { push: body.push, email: body.email };
  }

  async getRoutes(userId: string): Promise<RouteNotificationSettingsView> {
    const { push } = await this.current(userId);
    return { push: push.routes };
  }

  async putRoutes(
    userId: string,
    body: UpdateRouteNotificationSettings,
  ): Promise<RouteNotificationSettingsView> {
    const now = await this.consume(userId);
    await this.repository.saveRouteSettings(userId, body, now);
    return { push: body.push };
  }

  async getAchievements(userId: string): Promise<AchievementNotificationSettingsView> {
    const { push } = await this.current(userId);
    return { push: push.achievements };
  }

  async putAchievements(
    userId: string,
    body: UpdateAchievementNotificationSettings,
  ): Promise<AchievementNotificationSettingsView> {
    const now = await this.consume(userId);
    await this.repository.saveAchievementSettings(userId, body, now);
    return { push: body.push };
  }

  async getSocial(userId: string): Promise<SocialNotificationSettingsView> {
    const { push } = await this.current(userId);
    return { push: push.social };
  }

  async putSocial(
    userId: string,
    body: UpdateSocialNotificationSettings,
  ): Promise<SocialNotificationSettingsView> {
    const now = await this.consume(userId);
    await this.repository.saveSocialSettings(userId, body, now);
    return { push: body.push };
  }

  private async current(userId: string) {
    return (await this.repository.findSettings(userId)) ?? DEFAULT_DELIVERY_SETTINGS;
  }

  private async consume(userId: string): Promise<Date> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `notifications-settings:${userId}`,
      NOTIFICATIONS_POLICY.settingsLimit,
      now,
    );
    return now;
  }
}
