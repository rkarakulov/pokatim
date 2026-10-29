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
  FieldErrorCode,
  NotificationListQuery,
  type NotificationPage,
  NotificationSettings,
  RegisterPushToken,
  RegisterWebPushSubscription,
  RevokePushToken,
  RevokeWebPushSubscription,
  type UnreadCount,
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
