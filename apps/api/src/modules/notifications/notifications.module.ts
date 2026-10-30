import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { ENV } from '@rkarakulov/api-kit/core';

import { type Env, webPushVapid } from '../../config/env';

import { QUEUE } from '../../queues';
import { DeliveryJobs } from './delivery-jobs';
import { EmailDelivery } from './email-delivery';
import { FanoutJobs, NOTIFICATIONS_FANOUT_PRODUCER } from './fanout-jobs';
import { ExpoPushSender } from './expo-push.sender';
import { DisputesCoreModule } from '../disputes';
import { IdentityAccountsModule, IdentityModule } from '../identity';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { RoutesCoreModule } from '../routes';
import { TicketsCoreModule } from '../tickets';
import { NotificationIntake } from './notification-intake';
import { NotificationErasure } from './notification-erasure';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsDeliveryProcessor } from './notifications-delivery.processor';
import { NotificationsIntakeProcessor } from './notifications-intake.processor';
import {
  NotificationsMaintenanceProcessor,
  NotificationsSchedules,
} from './notifications-maintenance.processor';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { PushDelivery } from './push-delivery';
import { PushReceipts } from './push-receipts';
import { PUSH_SENDER } from './push-sender';
import { PushTokens } from './push-tokens';
import { PushTokensService } from './push-tokens.service';
import { HttpWebPushSender, WEB_PUSH_SENDER } from './web-push.sender';

/** Адаптер Expo Push API от `ENV` (адрес и ключ — только env). Без `PUSH_ENABLED` доставка его не вызывает. */
const pushSenderProvider: Provider = {
  provide: PUSH_SENDER,
  inject: [ENV],
  useFactory: (env: Env) =>
    new ExpoPushSender({
      apiUrl: env.EXPO_PUSH_API_URL,
      accessToken: env.EXPO_ACCESS_TOKEN ?? null,
    }),
};

/**
 * Адаптер Web Push (ADR-0022): только при `WEB_PUSH_ENABLED` и ключах VAPID, иначе `null` — доставка шлёт только Expo.
 */
const webPushSenderProvider: Provider = {
  provide: WEB_PUSH_SENDER,
  inject: [ENV],
  useFactory: (env: Env) => {
    const vapid = webPushVapid(env);
    return vapid
      ? new HttpWebPushSender({ vapid, testOrigin: env.WEB_PUSH_TEST_ORIGIN ?? null })
      : null;
  },
};

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

/** Центр уведомлений (ADR-0017): HTTP `/v1/notifications` под `AuthGuard` identity. */
@Module({
  imports: [IdentityModule, NotificationsCoreModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSettingsService, PushTokensService],
})
export class NotificationsModule {}

/**
 * Задачи `notifications` в worker (ADR-0017): приём событий источников и пачки получателей большого события
 * (`notifications-intake`, `notifications.fanout`), доставка push и писем
 * (`notifications-delivery`), регламент квитанций и перепостановки (`notifications-maintenance`). Источники — только
 * порты через их `index.ts`: `RESULTS_NOTICES` и `RACE_REGISTRY` (`ResultsCoreModule` реэкспортирует `RacesCoreModule`),
 * `DISPUTE_NOTICES`, `RIDE_NOTICES`, `ROUTE_NOTICES`, `TICKET_NOTICES` (`TicketsCoreModule`, PR D), `IdentityAccounts`.
 */
@Module({
  imports: [
    NotificationsCoreModule,
    ResultsCoreModule,
    DisputesCoreModule,
    RidesCoreModule,
    RoutesCoreModule,
    TicketsCoreModule,
    IdentityAccountsModule,
    BullModule.registerQueue(
      { name: QUEUE.notificationsIntake },
      { name: QUEUE.notificationsDelivery },
      { name: QUEUE.notificationsMaintenance },
    ),
    // атомарная постановка пачек получателей (`FlowProducer.addBulk` — MULTI), соединение — из `forRootAsync` базы
    BullModule.registerFlowProducer({ name: NOTIFICATIONS_FANOUT_PRODUCER }),
  ],
  providers: [
    NotificationIntake,
    NotificationsIntakeProcessor,
    pushSenderProvider,
    webPushSenderProvider,
    DeliveryJobs,
    FanoutJobs,
    PushDelivery,
    EmailDelivery,
    PushReceipts,
    NotificationsDeliveryProcessor,
    NotificationsMaintenanceProcessor,
    NotificationsSchedules,
  ],
})
export class NotificationsWorkerModule {}
