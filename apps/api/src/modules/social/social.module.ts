import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { IdentityAccountsModule, IdentityModule } from '../identity';
import { ProductEventsCoreModule } from '../product-events';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { AttendanceRepository } from './attendance.repository';
import { SocialAttendanceService } from './attendance.service';
import { AutoAttendanceIntake } from './auto-attendance-intake';
import { ConnectionsRepository } from './connections.repository';
import { SocialConnectionsService } from './connections.service';
import { InviteCodeController } from './invite-code.controller';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodes } from './invite-codes.service';
import { InviteIntake } from './invite-intake';
import { ReactionsRepository } from './reactions.repository';
import { LoggingRideAskDue, RIDE_ASK_DUE } from './ride-ask.port';
import { RideAskSweep } from './ride-ask-sweep';
import { RideParticipantsController } from './ride-participants.controller';
import { SocialRideParticipantsService } from './ride-participants.service';
import { SocialReactionsService } from './reactions.service';
import { SocialRespectController } from './respect.controller';
import { SocialRespectService } from './respect.service';
import { RiderSocialController } from './rider-social.controller';
import { RiderSocialService } from './rider-social.service';
import { SocialConnectionsController } from './social-connections.controller';
import { SocialErasure } from './social-erasure';
import { SocialIntakeProcessor } from './social-intake.processor';
import { SocialMaintenanceProcessor, SocialSchedules } from './social-maintenance.processor';
import { SOCIAL_NOTICES } from './social-notices.port';
import { SocialNoticesService } from './social-notices.service';

/**
 * Ядро «Свои» без HTTP (ADR-0027): единственные писатели связей, явки, реакций и кодов приглашений, сервисы домена,
 * порт стирания `SocialErasure` (`account`) и порт уведомлений `SOCIAL_NOTICES` (`notifications`, P7). Производители —
 * только через порты (`RIDES_FOR_SOCIAL`, `RIDER_NAMES`) и журнал метрик `PRODUCT_EVENTS`; события `social.*` — outbox
 * в транзакции действия.
 */
@Module({
  imports: [RidesCoreModule, ProfileCoreModule, ProductEventsCoreModule],
  providers: [
    ConnectionsRepository,
    AttendanceRepository,
    ReactionsRepository,
    InviteCodesRepository,
    SocialConnectionsService,
    SocialAttendanceService,
    SocialReactionsService,
    SocialErasure,
    SocialRideParticipantsService,
    InviteCodes,
    SocialNoticesService,
    { provide: SOCIAL_NOTICES, useExisting: SocialNoticesService },
  ],
  exports: [
    SocialConnectionsService,
    SocialAttendanceService,
    SocialReactionsService,
    SocialErasure,
    SocialRideParticipantsService,
    // порт кодов приглашений: адрес на карточке `sharing` (RC-P6-4) и intake приглашений (P6)
    InviteCodes,
    // захват «Как прошёл райд?» регламента `SocialWorkerModule` (P5); вне модуля `social` не уходит
    AttendanceRepository,
    // порт уведомлений K10 для `NotificationsWorkerModule` (P7)
    SOCIAL_NOTICES,
  ],
})
export class SocialCoreModule {}

/**
 * HTTP «Свои» (якорь композиции `AppModule`, RC-13): участники, явка и «спасибо» райда (P2, P4), профиль райдера и
 * список «Свои» (P3), «Респект» (P4), код приглашения (P6); P7 — свои контроллеры. Порты `RIDER_PROFILES`,
 * `RIDES_FOR_SOCIAL`, `RESULTS_FOR_SOCIAL` и `ROUTES_FOR_SOCIAL` — из ядер владельцев (порты «Респекта» нужны только
 * HTTP, RC-P4-12).
 */
@Module({
  imports: [
    SocialCoreModule,
    IdentityModule,
    ProfileCoreModule,
    RidesCoreModule,
    ResultsCoreModule,
    RoutesCoreModule,
  ],
  controllers: [
    RideParticipantsController,
    InviteCodeController,
    RiderSocialController,
    SocialConnectionsController,
    SocialRespectController,
  ],
  providers: [RiderSocialService, SocialRespectService],
})
export class SocialModule {}

/**
 * Задачи «Свои» в worker (якорь `WorkerModule`, RC-13): `social-intake` — приглашения (P6), автоявка (P5: порты
 * `ACTIVITY_STARTS`, `RIDES_FOR_SOCIAL`); `social-maintenance` — отбор «Как прошёл райд?» P5, отправка P7 (точка
 * `RIDE_ASK_DUE`, до P7 — заглушка `LoggingRideAskDue`). Живость аккаунтов — порт `IdentityAccounts`.
 */
@Module({
  imports: [
    SocialCoreModule,
    IdentityAccountsModule,
    TracksCoreModule,
    RidesCoreModule,
    BullModule.registerQueue({ name: QUEUE.socialIntake }, { name: QUEUE.socialMaintenance }),
  ],
  providers: [
    InviteIntake,
    SocialIntakeProcessor,
    AutoAttendanceIntake,
    RideAskSweep,
    LoggingRideAskDue,
    { provide: RIDE_ASK_DUE, useExisting: LoggingRideAskDue },
    SocialMaintenanceProcessor,
    SocialSchedules,
  ],
})
export class SocialWorkerModule {}
