import { Module } from '@nestjs/common';

import { PanelModule } from '../panel';
import { RacesRepository } from './races.repository';
import { SeasonsAdminController } from './seasons-admin.controller';
import { SeasonsService } from './seasons.service';

/**
 * Сезоны и гонки по коридору (ADR-0010, R1: одна граница — инвариант «гонка в сезоне ↔ сезон не выбрасывает гонки»
 * в одной транзакции). Панель — `/v1/admin/{seasons,races}` под `PanelGuard`; публичное чтение — без входа.
 * `panel` — только через `modules/panel/index.ts`.
 */
@Module({
  imports: [PanelModule],
  controllers: [SeasonsAdminController],
  providers: [RacesRepository, SeasonsService],
})
export class RacesModule {}
