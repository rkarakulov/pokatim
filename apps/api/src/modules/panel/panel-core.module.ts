import { Module } from '@nestjs/common';

import { IdentityAccountsModule } from '../identity';
import { PanelAudit } from './panel-audit';
import { PanelDirectory } from './panel-directory';
import { PanelMembership } from './panel-membership';
import { PanelMembersService } from './panel-members.service';
import { PanelRepository } from './panel.repository';
import { PanelTotpGuard } from './panel-totp-guard';

/**
 * Данные панели без HTTP: репозиторий, журнал, члены команды. Импортируют `PanelModule` (HTTP) и CLI
 * (`createApplicationContext`, без Redis и лимитера) — порт identity только для чтения аккаунтов.
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
  ],
  exports: [
    PanelRepository,
    PanelAudit,
    PanelDirectory,
    PanelMembersService,
    PanelMembership,
    PanelTotpGuard,
  ],
})
export class PanelCoreModule {}
