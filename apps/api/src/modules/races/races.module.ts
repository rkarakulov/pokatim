import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { RoutesCoreModule } from '../routes';
import { PublicReadGuard } from '../../public-read.guard';
import { RaceRegistryService } from './race-registry';
import { RACE_REGISTRY } from './race-registry.port';
import { RacesAdminController } from './races-admin.controller';
import { RacesPublicController } from './races-public.controller';
import { RacesPublicService } from './races-public.service';
import { RacesRepository } from './races.repository';
import { RacesService } from './races.service';
import { SeasonRacesService } from './season-races';
import { SEASON_RACES } from './season-races.port';
import { SeasonsAdminController } from './seasons-admin.controller';
import { SeasonsService } from './seasons.service';

/**
 * Ядро `races` для API и worker: репозиторий, порт `RaceRegistry` для модуля `results` и порт `SeasonRaces` для
 * `standings` (race-results-08) — через `index.ts`, без контроллеров.
 */
@Module({
  providers: [
    RacesRepository,
    RaceRegistryService,
    { provide: RACE_REGISTRY, useExisting: RaceRegistryService },
    SeasonRacesService,
    { provide: SEASON_RACES, useExisting: SeasonRacesService },
  ],
  exports: [RacesRepository, RACE_REGISTRY, SEASON_RACES],
})
export class RacesCoreModule {}

/**
 * Сезоны и гонки по коридору (ADR-0010, R1: одна граница — инвариант «гонка в сезоне ↔ сезон не выбрасывает гонки»
 * в одной транзакции). Панель — `/v1/admin/{seasons,races}` под `PanelGuard`; публичное чтение — без входа.
 * `panel` и `routes` (коридор: порт `RouteCatalog`) — только через их `index.ts`.
 */
@Module({
  imports: [PanelModule, RoutesCoreModule, RacesCoreModule],
  controllers: [SeasonsAdminController, RacesAdminController, RacesPublicController],
  providers: [SeasonsService, RacesService, RacesPublicService, PublicReadGuard],
  exports: [RacesCoreModule],
})
export class RacesModule {}
