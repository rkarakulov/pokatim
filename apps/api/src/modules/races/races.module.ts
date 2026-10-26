import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { RoutesCoreModule } from '../routes';
import { PublicReadGuard } from '../../public-read.guard';
import { RacesAdminController } from './races-admin.controller';
import { RacesPublicController } from './races-public.controller';
import { RacesPublicService } from './races-public.service';
import { RacesRepository } from './races.repository';
import { RacesService } from './races.service';
import { SeasonsAdminController } from './seasons-admin.controller';
import { SeasonsService } from './seasons.service';

/**
 * Сезоны и гонки по коридору (ADR-0010, R1: одна граница — инвариант «гонка в сезоне ↔ сезон не выбрасывает гонки»
 * в одной транзакции). Панель — `/v1/admin/{seasons,races}` под `PanelGuard`; публичное чтение — без входа.
 * `panel` и `routes` (коридор: порт `RouteCatalog`) — только через их `index.ts`.
 */
@Module({
  imports: [PanelModule, RoutesCoreModule],
  controllers: [SeasonsAdminController, RacesAdminController, RacesPublicController],
  providers: [RacesRepository, SeasonsService, RacesService, RacesPublicService, PublicReadGuard],
})
export class RacesModule {}
