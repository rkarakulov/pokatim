import { Module } from '@nestjs/common';

import { PublicReadGuard } from '../../public-read.guard';
import { PanelModule } from '../panel';
import { AppearanceAdminController } from './appearance-admin.controller';
import { AppearancePublicController } from './appearance-public.controller';
import { AppearanceRepository } from './appearance.repository';
import { AppearanceService } from './appearance.service';

/**
 * Оформление приложения: сезонный декор — глобальная настройка платформы (тема — личная, `profile`, ADR-0021). Панель
 * — `/v1/admin/appearance` под `PanelGuard`; приложение — публичное чтение `/v1/appearance`. `panel` — только через
 * `modules/panel/index.ts`. Потребителей вне модуля нет.
 */
@Module({
  imports: [PanelModule],
  controllers: [AppearanceAdminController, AppearancePublicController],
  providers: [AppearanceRepository, AppearanceService, PublicReadGuard],
})
export class AppearanceModule {}
