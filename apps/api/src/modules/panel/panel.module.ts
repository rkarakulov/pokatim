import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelAuditReader } from './panel-audit';
import { PanelAuditController } from './panel-audit.controller';
import { PanelCoreModule } from './panel-core.module';
import { PanelMembersController } from './panel-members.controller';
import { PanelGuard } from './panel.guard';
import { PanelSessionCheck } from './panel-session-check';
import { PanelSessionCookie } from './panel-session-cookie';
import { PanelSessionController } from './panel-session.controller';
import { PanelSessionService } from './panel-session.service';

/**
 * Панель «Протокол» — HTTP (`/v1/admin/*`, ADR-0009): сессия панели, гард и права. Будущие модули панели
 * импортируют `PanelModule` и берут `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit` из
 * `modules/panel/index.ts`. Identity — только порт `PanelCredentials`/`IdentityAccounts`.
 */
@Module({
  imports: [IdentityModule, PanelCoreModule],
  controllers: [PanelSessionController, PanelMembersController, PanelAuditController],
  providers: [
    PanelSessionCookie,
    PanelSessionCheck,
    PanelSessionService,
    PanelAuditReader,
    PanelGuard,
  ],
  // гард создаётся в модуле-потребителе (`@UseGuards`) — ему нужны и зависимости гарда
  exports: [PanelGuard, PanelSessionCookie, PanelSessionCheck, PanelCoreModule, IdentityModule],
})
export class PanelModule {}
