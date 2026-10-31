import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { RacesCoreModule } from '../races';
import { ResultsCoreModule } from '../results';
import { RiderSeasonStandingsService } from './rider-season-standings';
import { RIDER_SEASON_STANDINGS } from './rider-season-standings.port';
import { StandingsAdminController } from './standings-admin.controller';
import { StandingsMeController } from './standings-me.controller';
import { StandingsPublicController } from './standings-public.controller';
import { StandingsReadService } from './standings-read.service';
import { StandingsRecalc } from './standings-recalc';
import { StandingsSource } from './standings-source';
import { StandingsSchedules, StandingsSyncProcessor } from './standings-sync.processor';
import { StandingsRepository } from './standings.repository';

/**
 * Ядро рейтинга сезона (race-results-08) для API и worker: репозиторий снимка, источник (порты `SeasonRaces` модуля
 * `races` и `ResultsForStandings` модуля `results` — только через их `index.ts`) и пересчёт. `races`, `results` о
 * `standings` не знают. Порт `RIDER_SEASON_STANDINGS` — итоги райдера для `achievements` (сезонные достижения).
 */
@Module({
  imports: [RacesCoreModule, ResultsCoreModule],
  providers: [
    StandingsRepository,
    StandingsSource,
    StandingsRecalc,
    { provide: RIDER_SEASON_STANDINGS, useClass: RiderSeasonStandingsService },
  ],
  exports: [
    RacesCoreModule,
    StandingsRepository,
    StandingsSource,
    StandingsRecalc,
    RIDER_SEASON_STANDINGS,
  ],
})
export class StandingsCoreModule {}

/**
 * HTTP: публичная сводка и таблица (`PublicReadGuard`), свои строки (`AuthGuard`), панель (`PanelGuard` +
 * `races.read`). Имена — порт `RIDER_NAMES` (`ProfileCoreModule`).
 */
@Module({
  imports: [IdentityModule, PanelModule, ProfileCoreModule, StandingsCoreModule],
  controllers: [StandingsPublicController, StandingsMeController, StandingsAdminController],
  providers: [StandingsReadService, PublicReadGuard],
})
export class StandingsModule {}

/**
 * Очередь `standings-recalc` в worker: события протокола `results` (`standingsOutboxRoutes`) и регламент-страховка
 * сверки отпечатков каждые 15 мин и при старте (standings-outbox-events).
 */
@Module({
  imports: [StandingsCoreModule, BullModule.registerQueue({ name: QUEUE.standingsRecalc })],
  providers: [StandingsSyncProcessor, StandingsSchedules],
})
export class StandingsWorkerModule {}
