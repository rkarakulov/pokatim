import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { DisputesCoreModule } from '../disputes';
import { IdentityAccountsModule, IdentityModule } from '../identity';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { NotificationIntake } from './notification-intake';
import { NotificationErasure } from './notification-erasure';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsIntakeProcessor } from './notifications-intake.processor';
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

/**
 * Задачи `notifications` в worker (ADR-0016): приём событий источников (`notifications-intake`). Источники — только
 * порты через их `index.ts`: `RESULTS_NOTICES` и `RACE_REGISTRY` (`ResultsCoreModule` реэкспортирует `RacesCoreModule`),
 * `DISPUTE_NOTICES`, `RIDE_NOTICES`, `IdentityAccounts`. Доставка и регламент — шаг C.
 */
@Module({
  imports: [
    NotificationsCoreModule,
    ResultsCoreModule,
    DisputesCoreModule,
    RidesCoreModule,
    IdentityAccountsModule,
    BullModule.registerQueue({ name: QUEUE.notificationsIntake }),
  ],
  providers: [NotificationIntake, NotificationsIntakeProcessor],
})
export class NotificationsWorkerModule {}
