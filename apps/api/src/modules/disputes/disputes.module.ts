import { Global, Module } from '@nestjs/common';

import { RACE_CANCEL_GATE } from '../races';
import { RESULT_DISPUTE_GATE } from '../results';
import { DisputeGates } from './dispute-gates';
import { DisputesRepository } from './disputes.repository';

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
