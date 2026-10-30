import { Module } from '@nestjs/common';

import { IdentityAccountsModule } from '../identity';
import { PanelAudit } from './panel-audit';
import { PanelDirectory } from './panel-directory';
import { PanelInvitationsRepository } from './panel-invitations.repository';
import { PanelMembership } from './panel-membership';
import { PanelMembersService } from './panel-members.service';
import { PanelRepository } from './panel.repository';
import { PanelTotpGuard } from './panel-totp-guard';

/**
 * Данные панели без HTTP: репозиторий, журнал, члены команды. Импортируют `PanelModule` (HTTP) и CLI
 * (`createApplicationContext`, без Redis и лимитера) и worker — порт identity только для чтения аккаунтов; outbox
 * (`MongoOutboxWriter`) — глобальный `MongoOutboxModule` приложения, worker и CLI.
 */
@Module({
  imports: [IdentityAccountsModule],
  providers: [
    PanelRepository,
    PanelAudit,
    PanelDirectory,
    PanelMembersService,
    PanelMembership,
    PanelTotpGuard,
    PanelInvitationsRepository,
  ],
  exports: [
    PanelRepository,
    PanelAudit,
    PanelDirectory,
    PanelMembersService,
    PanelMembership,
    PanelTotpGuard,
    PanelInvitationsRepository,
  ],
})
export class PanelCoreModule {}
