import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { RacesCoreModule } from '../races';
import { RoutesCoreModule } from '../routes';
import { TracksCoreModule } from '../tracks';
import { AttemptCheckProcessor } from './attempt-check.processor';
import { AttemptIntake } from './attempt-intake';
import { AttemptsService } from './attempts.service';
import { EntriesService } from './entries.service';
import { ProfileRacesController } from './profile-races.controller';
import { RaceEntryController } from './race-entry.controller';
import { RiderResultsService } from './rider-results';
import { RIDER_RESULTS } from './rider-results.port';
import { ResultsAdminController } from './results-admin.controller';
import { ResultsForDisputesService } from './results-for-disputes';
import { ResultsForSharingService } from './results-for-sharing';
import { RESULTS_FOR_SHARING } from './results-for-sharing.port';
import { ResultsForStandingsService } from './results-for-standings';
import { ResultsForTicketsService } from './results-for-tickets';
import { RESULTS_FOR_TICKETS } from './results-for-tickets.port';
import { ResultsHistoryService } from './results-history.service';
import { RESULTS_FOR_STANDINGS } from './results-for-standings.port';
import { RESULTS_FOR_DISPUTES } from './results-for-disputes.port';
import { ResultsNoticesService } from './results-notices';
import { RESULTS_NOTICES } from './results-notices.port';
import { ResultsIntakeProcessor } from './results-intake.processor';
import { ResultsMaintenanceProcessor, ResultsSchedules } from './results-maintenance.processor';
import { ResultsOverview } from './results-overview';
import { ResultsPanelReadService } from './results-panel-read.service';
import { ResultsProtocolController } from './results-protocol.controller';
import { ResultsProtocolService } from './results-protocol.service';
import { ResultsPublicController } from './results-public.controller';
import { ResultsReadService } from './results-read.service';
import { ResultsRecheck } from './results-recheck';
import { ResultsRepository } from './results.repository';

/**
 * Ядро `results` для API и worker: репозиторий, приём попыток, чтение, перепроверка. Другие модули — только через
 * их `index.ts` (порты `RaceRegistry`, `RouteGeometry`, `ActivitySource`, `RiderNameDirectory` (`profile`));
 * `races`, `routes`, `tracks`, `profile` о `results` не знают. Для `disputes` (race-results-06) — порт
 * `RESULTS_FOR_DISPUTES`; гейт споров `RESULT_DISPUTE_GATE` даёт `@Global DisputesCoreModule`. Для `notifications` —
 * порт `RESULTS_NOTICES` (получатели уведомлений, ADR-0017). Для `standings` (race-results-08) — порт
 * `RESULTS_FOR_STANDINGS` (текущие ревизии и строки снимка протокола). Для `sharing` (story-cards) — порт
 * `RESULTS_FOR_SHARING` (факты и линия карточки для сторис). Для `riders` (rider-profile) — порт `RIDER_RESULTS`
 * (строки райдера в текущих ревизиях опубликованных протоколов). Для `tickets` (event-tickets) — порт
 * `RESULTS_FOR_TICKETS` (заявка райдера и заявки гонки пачками).
 */
@Module({
  imports: [RacesCoreModule, RoutesCoreModule, TracksCoreModule, ProfileCoreModule],
  providers: [
    ResultsRepository,
    AttemptIntake,
    ResultsReadService,
    ResultsRecheck,
    ResultsForDisputesService,
    { provide: RESULTS_FOR_DISPUTES, useExisting: ResultsForDisputesService },
    ResultsNoticesService,
    { provide: RESULTS_NOTICES, useExisting: ResultsNoticesService },
    ResultsForStandingsService,
    { provide: RESULTS_FOR_STANDINGS, useExisting: ResultsForStandingsService },
    ResultsForSharingService,
    { provide: RESULTS_FOR_SHARING, useExisting: ResultsForSharingService },
    RiderResultsService,
    { provide: RIDER_RESULTS, useExisting: RiderResultsService },
    ResultsForTicketsService,
    { provide: RESULTS_FOR_TICKETS, useExisting: ResultsForTicketsService },
  ],
  exports: [
    RacesCoreModule,
    RoutesCoreModule,
    TracksCoreModule,
    ResultsRepository,
    AttemptIntake,
    ResultsReadService,
    ResultsRecheck,
    RESULTS_FOR_DISPUTES,
    RESULTS_NOTICES,
    RESULTS_FOR_STANDINGS,
    RESULTS_FOR_SHARING,
    RIDER_RESULTS,
    RESULTS_FOR_TICKETS,
  ],
})
export class ResultsCoreModule {}

/**
 * HTTP: участие (`AuthGuard`), публичная таблица (`PublicReadGuard`), панель (`PanelGuard`) — чтение и действия над
 * протоколом (race-results-05). `ProfileCoreModule` — порт `RIDER_NAMES` для имён в панели (profile-02; ядро его не
 * реэкспортирует).
 */
@Module({
  imports: [IdentityModule, PanelModule, ProfileCoreModule, ResultsCoreModule],
  controllers: [
    ProfileRacesController,
    RaceEntryController,
    ResultsPublicController,
    ResultsAdminController,
    ResultsProtocolController,
  ],
  providers: [
    EntriesService,
    AttemptsService,
    ResultsHistoryService,
    ResultsPanelReadService,
    ResultsProtocolService,
    PublicReadGuard,
    ResultsOverview,
  ],
  // «Обзор» панели (admin-overview): чек-лист публикации живёт в панельном чтении, поэтому порт — здесь, не в ядре
  exports: [ResultsOverview],
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
