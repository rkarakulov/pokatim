import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { DevicesCoreModule } from '../devices';
import { IdentityErasureModule, IdentityModule } from '../identity';
import { NotificationsCoreModule } from '../notifications';
import { PanelCoreModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { RidesCoreModule } from '../rides';
import { RouteRidesCoreModule } from '../route-rides';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { AccountDeletionService } from './account-deletion.service';
import { AccountErasureProcessor } from './account-erasure.processor';
import { AccountErasureService } from './account-erasure.service';
import { AccountSchedules } from './account-schedules';
import { AccountController } from './account.controller';

/**
 * Удаление аккаунта, HTTP-часть (ADR-0015): оркестратор без своих коллекций — identity (`AccountClosure`, `AuthGuard`,
 * `SessionCookie`), panel (`PanelMembership`, `PanelAudit`) и notifications (`PushTokens` — снятие токенов в транзакции)
 * только через их `index.ts`. Никто не импортирует `account`.
 */
@Module({
  imports: [IdentityModule, PanelCoreModule, NotificationsCoreModule],
  controllers: [AccountController],
  providers: [AccountDeletionService],
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
    DevicesCoreModule,
    NotificationsCoreModule,
    BullModule.registerQueue({ name: QUEUE.accountDeletion }),
  ],
  providers: [AccountErasureService, AccountErasureProcessor, AccountSchedules],
})
export class AccountWorkerModule {}
