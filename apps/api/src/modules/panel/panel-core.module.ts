import { Module } from '@nestjs/common';

import { IdentityAccountsModule } from '../identity';
import { PanelAudit } from './panel-audit';
import { PanelMembersService } from './panel-members.service';
import { PanelRepository } from './panel.repository';

/**
 * Данные панели без HTTP: репозиторий, журнал, члены команды. Импортируют `PanelModule` (HTTP) и CLI
 * (`createApplicationContext`, без Redis и лимитера) — порт identity только для чтения аккаунтов.
 */
@Module({
  imports: [IdentityAccountsModule],
  providers: [PanelRepository, PanelAudit, PanelMembersService],
  exports: [PanelRepository, PanelAudit, PanelMembersService],
})
export class PanelCoreModule {}
