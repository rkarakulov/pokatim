import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AchievementNotificationSettingsView,
  type EventNotificationSettingsView,
  FieldErrorCode,
  NotificationListQuery,
  type NotificationPage,
  NotificationSettings,
  RegisterPushToken,
  RegisterWebPushSubscription,
  RevokePushToken,
  RevokeWebPushSubscription,
  type RouteNotificationSettingsView,
  type SocialNotificationSettingsView,
  type UnreadCount,
  UpdateAchievementNotificationSettings,
  UpdateEventNotificationSettings,
  UpdateRouteNotificationSettings,
  UpdateSocialNotificationSettings,
  Uuid,
  type WebPushConfig,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsService } from './notifications.service';
import { PushTokensService } from './push-tokens.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Центр уведомлений (ADR-0017): только вошедший, только свои (`@CurrentUser()`). Статические пути (`unread-count`,
 * `settings`, `push-tokens`, `web-push`, `read-all`) объявлены до `:id/read`. Чтения — `no-store`.
 */
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly settings: NotificationSettingsService,
    private readonly pushTokens: PushTokensService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(NotificationListQuery, FieldErrorCode))
    query: NotificationListQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(user.userId, query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCount> {
    return this.notifications.unreadCount(user.userId);
  }

  @Get('settings')
  @Header('Cache-Control', 'no-store')
  getSettings(@CurrentUser() user: AuthUser): Promise<NotificationSettings> {
    return this.settings.get(user.userId);
  }

  @Put('settings')
  @HttpCode(200)
  putSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(NotificationSettings, FieldErrorCode)) body: NotificationSettings,
  ): Promise<NotificationSettings> {
    return this.settings.put(user.userId, body);
  }

  /** Группа «Мероприятия» — подресурс (RC-D1): прежний `/settings` не меняет форму. */
  @Get('settings/events')
  @Header('Cache-Control', 'no-store')
  getEventSettings(@CurrentUser() user: AuthUser): Promise<EventNotificationSettingsView> {
    return this.settings.getEvents(user.userId);
  }

  @Put('settings/events')
  @HttpCode(200)
  putEventSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateEventNotificationSettings, FieldErrorCode))
    body: UpdateEventNotificationSettings,
  ): Promise<EventNotificationSettingsView> {
    return this.settings.putEvents(user.userId, body);
  }

  /** Группа «Маршруты» — подресурс, только push (писем у группы нет). */
  @Get('settings/routes')
  @Header('Cache-Control', 'no-store')
  getRouteSettings(@CurrentUser() user: AuthUser): Promise<RouteNotificationSettingsView> {
    return this.settings.getRoutes(user.userId);
  }

  @Put('settings/routes')
  @HttpCode(200)
  putRouteSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateRouteNotificationSettings, FieldErrorCode))
    body: UpdateRouteNotificationSettings,
  ): Promise<RouteNotificationSettingsView> {
    return this.settings.putRoutes(user.userId, body);
  }

  /** Группа «Достижения» — подресурс, только push (achievements-push, P4). */
  @Get('settings/achievements')
  @Header('Cache-Control', 'no-store')
  getAchievementSettings(
    @CurrentUser() user: AuthUser,
  ): Promise<AchievementNotificationSettingsView> {
    return this.settings.getAchievements(user.userId);
  }

  @Put('settings/achievements')
  @HttpCode(200)
  putAchievementSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateAchievementNotificationSettings, FieldErrorCode))
    body: UpdateAchievementNotificationSettings,
  ): Promise<AchievementNotificationSettingsView> {
    return this.settings.putAchievements(user.userId, body);
  }

  /** Группа «Свои» — подресурс, только push (social-p1, K10). */
  @Get('settings/social')
  @Header('Cache-Control', 'no-store')
  getSocialSettings(@CurrentUser() user: AuthUser): Promise<SocialNotificationSettingsView> {
    return this.settings.getSocial(user.userId);
  }

  @Put('settings/social')
  @HttpCode(200)
  putSocialSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateSocialNotificationSettings, FieldErrorCode))
    body: UpdateSocialNotificationSettings,
  ): Promise<SocialNotificationSettingsView> {
    return this.settings.putSocial(user.userId, body);
  }

  @Put('push-tokens')
  @HttpCode(204)
  registerPushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RegisterPushToken, FieldErrorCode)) body: RegisterPushToken,
  ): Promise<void> {
    return this.pushTokens.register(user.userId, user.sessionId, body);
  }

  @Post('push-tokens/revoke')
  @HttpCode(204)
  revokePushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RevokePushToken, FieldErrorCode)) body: RevokePushToken,
  ): Promise<void> {
    return this.pushTokens.revoke(user.userId, body);
  }

  @Get('web-push')
  @Header('Cache-Control', 'no-store')
  webPushConfig(): WebPushConfig {
    return this.pushTokens.webPushConfig();
  }

  @Put('web-push/subscriptions')
  @HttpCode(204)
  registerWebPush(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RegisterWebPushSubscription, FieldErrorCode))
    body: RegisterWebPushSubscription,
  ): Promise<void> {
    return this.pushTokens.registerWeb(user.userId, user.sessionId, body);
  }

  @Post('web-push/subscriptions/revoke')
  @HttpCode(204)
  revokeWebPush(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RevokeWebPushSubscription, FieldErrorCode))
    body: RevokeWebPushSubscription,
  ): Promise<void> {
    return this.pushTokens.revokeWeb(user.userId, body);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<void> {
    return this.notifications.markRead(user.userId, id);
  }
}
