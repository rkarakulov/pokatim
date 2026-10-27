import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { NotificationErasure } from './notification-erasure';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { PushTokens } from './push-tokens';
import { PushTokensService } from './push-tokens.service';

/**
 * Ядро `notifications` без HTTP и без модулей-источников: единственный писатель коллекций центра и порты для `account`
 * (`PushTokens` — снятие токенов в транзакции удаления, `NotificationErasure` — шаг стирания). `account` не тянет
 * `results`/`rides` транзитивно.
 */
@Module({
  providers: [NotificationsRepository, PushTokens, NotificationErasure],
  exports: [NotificationsRepository, PushTokens, NotificationErasure],
})
export class NotificationsCoreModule {}

/** Центр уведомлений (ADR-0016): HTTP `/v1/notifications` под `AuthGuard` identity. */
@Module({
  imports: [IdentityModule, NotificationsCoreModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSettingsService, PushTokensService],
})
export class NotificationsModule {}
