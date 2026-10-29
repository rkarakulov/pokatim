import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { ActivitySourceService } from './activity-source';
import { ActivityTotalsService } from './activity-totals';
import { ACTIVITY_TOTALS } from './activity-totals.port';
import { ACTIVITY_SOURCE } from './activity-source.port';
import { FsTrackFileStore } from './fs-track-file-store';
import { TRACK_FILE_STORE } from './track-file-store';
import { TrackErasure } from './track-erasure';
import { TrackIngestService } from './track-ingest';
import { TRACK_INGEST } from './track-ingest.port';
import { TrackProcessingProcessor } from './track-processing.processor';
import { TrackSourcesService } from './track-sources.service';
import { TrackUploadsController } from './track-uploads.controller';
import { TrackUploadsService } from './track-uploads.service';
import { TracksOverview } from './tracks-overview';
import { TracksMaintenanceProcessor, TracksSchedules } from './tracks-maintenance.processor';
import { TracksRepository } from './tracks.repository';

/**
 * Ядро `tracks` для API и worker: репозиторий, хранилище исходников (порт, на dev — ФС), приём исходника,
 * удаление, порт `TrackIngest` для модуля `devices`, `ActivitySource` для `results`, `TrackErasure` для `account` и
 * `TracksOverview` для «Обзора» панели (только через `index.ts`).
 */
@Module({
  providers: [
    TracksRepository,
    {
      provide: TRACK_FILE_STORE,
      inject: [ENV],
      useFactory: (env: Env) => new FsTrackFileStore(env.TRACK_STORAGE_DIR),
    },
    TrackSourcesService,
    TrackUploadsService,
    TrackIngestService,
    { provide: TRACK_INGEST, useExisting: TrackIngestService },
    ActivitySourceService,
    { provide: ACTIVITY_SOURCE, useExisting: ActivitySourceService },
    ActivityTotalsService,
    { provide: ACTIVITY_TOTALS, useExisting: ActivityTotalsService },
    TrackErasure,
    TracksOverview,
  ],
  exports: [
    TRACK_INGEST,
    ACTIVITY_SOURCE,
    ACTIVITY_TOTALS,
    TracksRepository,
    TRACK_FILE_STORE,
    TrackSourcesService,
    TrackUploadsService,
    TrackErasure,
    TracksOverview,
  ],
})
export class TracksCoreModule {}

/** HTTP-часть: ручная загрузка и свои загрузки (под `AuthGuard`); разбор — только в worker. */
@Module({
  imports: [IdentityModule, TracksCoreModule],
  controllers: [TrackUploadsController],
  exports: [TracksCoreModule],
})
export class TracksModule {}

/** Задачи `tracks` в worker: разбор исходника (`worker_threads`) и уборка хранилища. */
@Module({
  imports: [
    TracksCoreModule,
    BullModule.registerQueue({ name: QUEUE.trackProcessing }, { name: QUEUE.tracksMaintenance }),
  ],
  providers: [TrackProcessingProcessor, TracksMaintenanceProcessor, TracksSchedules],
  exports: [TracksCoreModule],
})
export class TracksWorkerModule {}
