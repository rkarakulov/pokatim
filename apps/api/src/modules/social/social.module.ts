import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { IdentityAccountsModule, IdentityModule } from '../identity';
import { ProductEventsCoreModule } from '../product-events';
import { ProfileCoreModule } from '../profile';
import { RidesCoreModule } from '../rides';
import { AttendanceRepository } from './attendance.repository';
import { SocialAttendanceService } from './attendance.service';
import { ConnectionsRepository } from './connections.repository';
import { SocialConnectionsService } from './connections.service';
import { InviteCodeController } from './invite-code.controller';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodes } from './invite-codes.service';
import { InviteIntake } from './invite-intake';
import { ReactionsRepository } from './reactions.repository';
import { RideParticipantsController } from './ride-participants.controller';
import { SocialRideParticipantsService } from './ride-participants.service';
import { SocialReactionsService } from './reactions.service';
import { SocialErasure } from './social-erasure';
import { SocialIntakeProcessor } from './social-intake.processor';

/**
 * Ядро «Свои» без HTTP (ADR-0027): единственные писатели связей, явки, реакций и кодов приглашений, сервисы домена и
 * порт стирания `SocialErasure` (`account`). Производители — только через порты (`RIDES_FOR_SOCIAL`, `RIDER_NAMES`) и
 * журнал метрик `PRODUCT_EVENTS`.
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
  ],
  exports: [
    SocialConnectionsService,
    SocialAttendanceService,
    SocialReactionsService,
    SocialErasure,
    SocialRideParticipantsService,
    // порт кодов приглашений: адрес на карточке `sharing` (RC-P6-4) и intake приглашений (P6)
    InviteCodes,
  ],
})
export class SocialCoreModule {}

/** HTTP «Свои» (якорь композиции `AppModule`, RC-13): участники и явка райда — P2, код приглашения — P6; далее P3, P4, P7. */
@Module({
  imports: [SocialCoreModule, IdentityModule],
  controllers: [RideParticipantsController, InviteCodeController],
})
export class SocialModule {}

/**
 * Задачи «Свои» в worker (якорь `WorkerModule`, RC-13): `social-intake` — приглашения (P6), автоявка (P5);
 * `social-maintenance` — P7. Живость аккаунтов — порт `IdentityAccounts`.
 */
@Module({
  imports: [
    SocialCoreModule,
    IdentityAccountsModule,
    BullModule.registerQueue({ name: QUEUE.socialIntake }),
  ],
  providers: [InviteIntake, SocialIntakeProcessor],
})
export class SocialWorkerModule {}
