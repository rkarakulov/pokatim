import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { QUEUE } from '../../queues';

import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { RACE_CANCEL_GATE } from '../races';
import { RESULT_DISPUTE_GATE, ResultsCoreModule } from '../results';
import { TracksCoreModule } from '../tracks';
import { DisputeGates } from './dispute-gates';
import { DisputesOverview } from './disputes-overview';
import { DisputeNoticesService } from './dispute-notices';
import { DISPUTE_NOTICES } from './dispute-notices.port';
import { DisputeSeriesCache } from './dispute-series.cache';
import { DisputeSeriesProcessor } from './dispute-series.processor';
import { DisputeSeriesService } from './dispute-series.service';
import { DisputesAdminController } from './disputes-admin.controller';
import { DisputesController } from './disputes.controller';
import { DisputesPanelService } from './disputes-panel.service';
import { DisputesRepository } from './disputes.repository';
import { DisputesService } from './disputes.service';

/**
 * Ядро `disputes` (RC-1): репозиторий и гейты для `results` (`RESULT_DISPUTE_GATE`) и `races` (`RACE_CANCEL_GATE`),
 * стороны спора для `notifications` (`DISPUTE_NOTICES`, ADR-0017), счётчик открытых споров для `overview`.
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
    DisputeNoticesService,
    { provide: DISPUTE_NOTICES, useExisting: DisputeNoticesService },
    DisputesOverview,
  ],
  exports: [
    DisputesRepository,
    RESULT_DISPUTE_GATE,
    RACE_CANCEL_GATE,
    DISPUTE_NOTICES,
    DisputesOverview,
  ],
})
export class DisputesCoreModule {}

/**
 * Споры по результатам гонки (race-results-06): приложение — `AuthGuard` identity; панель — `/v1/admin/disputes` под
 * `PanelGuard`. `results` и `races` — только порты через их `index.ts` (`ResultsForDisputes`, `RaceRegistry`).
 */
@Module({
  imports: [
    IdentityModule,
    PanelModule,
    ResultsCoreModule,
    BullModule.registerQueue({ name: QUEUE.disputeSeries }),
  ],
  controllers: [DisputesController, DisputesAdminController],
  providers: [DisputesService, DisputesPanelService, DisputeSeriesService, DisputeSeriesCache],
})
export class DisputesModule {}

/**
 * Задачи `disputes` в worker (race-results-06b): ряды пульса и мощности для разбора спора — поток разбора, итог в кэш
 * Redis. `results` — порт `ResultsForDisputes`, исходник — порт `tracks` `ActivitySource` (через их `index.ts`).
 */
@Module({
  imports: [
    ResultsCoreModule,
    TracksCoreModule,
    BullModule.registerQueue({ name: QUEUE.disputeSeries }),
  ],
  providers: [DisputeSeriesCache, DisputeSeriesProcessor],
})
export class DisputesWorkerModule {}
