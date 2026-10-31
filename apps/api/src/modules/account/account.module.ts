import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { AchievementsCoreModule } from '../achievements';
import { DevicesCoreModule } from '../devices';
import { IdentityErasureModule, IdentityModule } from '../identity';
import { NotificationsCoreModule } from '../notifications';
import { PanelModule } from '../panel';
import { ProductEventsCoreModule } from '../product-events';
import { ProfileCoreModule } from '../profile';
import { RidesCoreModule } from '../rides';
import { RouteRidesCoreModule } from '../route-rides';
import { RoutesCoreModule } from '../routes';
import { SocialCoreModule } from '../social';
import { TicketsCoreModule } from '../tickets';
import { TracksCoreModule } from '../tracks';
import { AccountDeletionService } from './account-deletion.service';
import { AccountErasuresAdminController } from './account-erasures-admin.controller';
import { AccountErasuresAdminService } from './account-erasures-admin.service';
import { AccountErasureProcessor } from './account-erasure.processor';
import { AccountErasureService } from './account-erasure.service';
import { AccountSchedules } from './account-schedules';
import { AccountController } from './account.controller';

/**
 * Удаление аккаунта, HTTP-часть (ADR-0015): оркестратор без своих коллекций — identity (`AccountClosure`, `AuthGuard`,
 * `SessionCookie`, `ErasureFailures`), panel (`PanelMembership`, `PanelAudit`, `PanelGuard` экрана сбоев удаления)
 * и notifications (`PushTokens` — снятие токенов в транзакции)
 * только через их `index.ts`. Никто не импортирует `account`.
 */
@Module({
  imports: [IdentityModule, PanelModule, NotificationsCoreModule],
  controllers: [AccountController, AccountErasuresAdminController],
  providers: [AccountDeletionService, AccountErasuresAdminService],
})
export class AccountModule {}

/**
 * Фоновая очистка удалённого аккаунта в worker: очередь `account-deletion`, порты стирания модулей-владельцев, регламент
 * повторного прохода. Новый модуль с данными пользователя обязан дать порт стирания и шаг здесь (ADR-0015).
 */
@Module({
  imports: [
    IdentityErasureModule,
    ProfileCoreModule,
    RidesCoreModule,
    RoutesCoreModule,
    TracksCoreModule,
    RouteRidesCoreModule,
    AchievementsCoreModule,
    TicketsCoreModule,
    DevicesCoreModule,
    NotificationsCoreModule,
    SocialCoreModule,
    ProductEventsCoreModule,
    BullModule.registerQueue({ name: QUEUE.accountDeletion }),
  ],
  providers: [AccountErasureService, AccountErasureProcessor, AccountSchedules],
})
export class AccountWorkerModule {}
