import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE } from '../../queues';
import { IdentityAccountsModule } from '../identity';
import { InvitationEmailHandler } from './jobs/invitation-email.handler';
import { PanelEmailProcessor } from './jobs/panel-email.processor';
import { RoleEmailHandler } from './jobs/role-email.handler';
import { PanelCoreModule } from './panel-core.module';

/** Задачи `panel` в worker (ADR-0026): письмо-приглашение и письма о роли — очередь `panel-email`. */
@Module({
  imports: [
    PanelCoreModule,
    IdentityAccountsModule,
    BullModule.registerQueue({ name: QUEUE.panelEmail }),
  ],
  providers: [InvitationEmailHandler, RoleEmailHandler, PanelEmailProcessor],
})
export class PanelWorkerModule {}
