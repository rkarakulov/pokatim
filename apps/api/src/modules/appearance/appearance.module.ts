import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { PanelModule } from '../panel';
import { APP_APPEARANCE } from './app-appearance.port';
import { AppAppearanceService } from './app-appearance.service';
import { AppearanceAdminController } from './appearance-admin.controller';
import { AppearancePublicController } from './appearance-public.controller';
import { AppearanceRepository } from './appearance.repository';
import { AppearanceService } from './appearance.service';

/**
 * Ядро `appearance` для API и worker (story-cards): репозиторий и порт `APP_APPEARANCE` (активная тема) — без
 * контроллеров и панели.
 */
@Module({
  providers: [
    AppearanceRepository,
    AppAppearanceService,
    { provide: APP_APPEARANCE, useExisting: AppAppearanceService },
  ],
  exports: [AppearanceRepository, APP_APPEARANCE],
})
export class AppearanceCoreModule {}

/**
 * Тема приложения (app-themes): глобальная настройка платформы. Панель — `/v1/admin/appearance` под `PanelGuard`;
 * приложение — публичное чтение `/v1/appearance`. `panel` — только через `modules/panel/index.ts`.
 */
@Module({
  imports: [AppearanceCoreModule, PanelModule],
  controllers: [AppearanceAdminController, AppearancePublicController],
  providers: [AppearanceService, PublicReadGuard],
})
export class AppearanceModule {}
