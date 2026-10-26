import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { RacesCoreModule } from '../races';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { AttemptCheckProcessor } from './attempt-check.processor';
import { AttemptIntake } from './attempt-intake';
import { AttemptsService } from './attempts.service';
import { EntriesService } from './entries.service';
import { RaceEntryController } from './race-entry.controller';
import { ResultsAdminController } from './results-admin.controller';
import { ResultsIntakeProcessor } from './results-intake.processor';
import { ResultsMaintenanceProcessor, ResultsSchedules } from './results-maintenance.processor';
import { ResultsPublicController } from './results-public.controller';
import { ResultsReadService } from './results-read.service';
import { ResultsRecheck } from './results-recheck';
import { ResultsRepository } from './results.repository';

/**
 * Ядро `results` для API и worker: репозиторий, приём попыток, чтение, перепроверка. Другие модули — только через
 * их `index.ts` (порты `RaceRegistry`, `RouteGeometry`, `ActivitySource`); `races`, `routes`, `tracks` о `results`
 * не знают.
 */
@Module({
  imports: [RacesCoreModule, RoutesCoreModule, TracksCoreModule],
  providers: [ResultsRepository, AttemptIntake, ResultsReadService, ResultsRecheck],
  exports: [
    RacesCoreModule,
    RoutesCoreModule,
    TracksCoreModule,
    ResultsRepository,
    AttemptIntake,
    ResultsReadService,
    ResultsRecheck,
  ],
})
export class ResultsCoreModule {}

/** HTTP: участие (`AuthGuard`), публичная таблица (`PublicReadGuard`), панель только чтения (`PanelGuard`). */
@Module({
  imports: [IdentityModule, PanelModule, ResultsCoreModule],
  controllers: [RaceEntryController, ResultsPublicController, ResultsAdminController],
  providers: [EntriesService, AttemptsService, PublicReadGuard],
})
export class ResultsModule {}

/** Задачи `results` в worker: приём попыток, сверка с коридором (поток разбора), регламент зависших проверок. */
@Module({
  imports: [
    ResultsCoreModule,
    BullModule.registerQueue(
      { name: QUEUE.resultsIntake },
      { name: QUEUE.attemptCheck },
      { name: QUEUE.resultsMaintenance },
    ),
  ],
  providers: [
    ResultsIntakeProcessor,
    AttemptCheckProcessor,
    ResultsMaintenanceProcessor,
    ResultsSchedules,
  ],
})
export class ResultsWorkerModule {}
