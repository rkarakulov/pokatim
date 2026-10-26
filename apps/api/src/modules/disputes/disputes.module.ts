import { Global, Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { RACE_CANCEL_GATE } from '../races';
import { RESULT_DISPUTE_GATE, ResultsCoreModule } from '../results';
import { DisputeGates } from './dispute-gates';
import { DisputesAdminController } from './disputes-admin.controller';
import { DisputesController } from './disputes.controller';
import { DisputesPanelService } from './disputes-panel.service';
import { DisputesRepository } from './disputes.repository';
import { DisputesService } from './disputes.service';

/**
 * Ядро `disputes` (RC-1): репозиторий и гейты для `results` (`RESULT_DISPUTE_GATE`) и `races` (`RACE_CANCEL_GATE`).
 * `@Global`: `results` и `races` о `disputes` не знают (цикла импортов нет), а инъекция гейтов обязательная —
 * модуль импортируют оба корня композиции, `AppModule` и `WorkerModule` (приёму попыток в worker нужен D-39).
 */
@Global()
@Module({
  providers: [
    DisputesRepository,
    DisputeGates,
    { provide: RESULT_DISPUTE_GATE, useExisting: DisputeGates },
    { provide: RACE_CANCEL_GATE, useExisting: DisputeGates },
  ],
  exports: [DisputesRepository, RESULT_DISPUTE_GATE, RACE_CANCEL_GATE],
})
export class DisputesCoreModule {}

/**
 * Споры по результатам гонки (race-results-06): приложение — `AuthGuard` identity; панель — `/v1/admin/disputes` под
 * `PanelGuard`. `results` и `races` — только порты через их `index.ts` (`ResultsForDisputes`, `RaceRegistry`).
 */
@Module({
  imports: [IdentityModule, PanelModule, ResultsCoreModule],
  controllers: [DisputesController, DisputesAdminController],
  providers: [DisputesService, DisputesPanelService],
})
export class DisputesModule {}
