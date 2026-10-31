import { Module } from '@nestjs/common';

import { ProductEventsCoreModule } from '../product-events';
import { ProfileCoreModule } from '../profile';
import { RidesCoreModule } from '../rides';
import { AttendanceRepository } from './attendance.repository';
import { SocialAttendanceService } from './attendance.service';
import { ConnectionsRepository } from './connections.repository';
import { SocialConnectionsService } from './connections.service';
import { InviteCodesRepository } from './invite-codes.repository';
import { ReactionsRepository } from './reactions.repository';
import { SocialReactionsService } from './reactions.service';
import { SocialErasure } from './social-erasure';

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
  ],
  exports: [
    SocialConnectionsService,
    SocialAttendanceService,
    SocialReactionsService,
    SocialErasure,
  ],
})
export class SocialCoreModule {}

/** HTTP «Свои»: контроллеры — в P2–P4, P7 (якорь композиции `AppModule`, RC-13). */
@Module({ imports: [SocialCoreModule], controllers: [] })
export class SocialModule {}

/** Задачи «Свои» в worker: процессоры `social-intake` и `social-maintenance` — в P5, P7 (якорь `WorkerModule`, RC-13). */
@Module({ imports: [SocialCoreModule], providers: [] })
export class SocialWorkerModule {}
