import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { AppAppearance } from '@pokatim/contracts';

import { PublicReadGuard } from '../../public-read.guard';
import { AppearanceService } from './appearance.service';

/**
 * Оформление приложения: без входа, одинаково для всех, IP-лимит `public-read`. `themeId` — всегда `classic` для сборок
 * до user-theme (тема — личная, `GET /v1/profile`); `decor` — сезонный декор. Кэш браузера — `no-cache`, не
 * общие 60 с публичного чтения: после смены оформления в панели закэшированный ответ перекрашивал свежую SSR-страницу в
 * прежнее. Запрос — раз на загрузку и на возврат фокуса, ответ — один ключ.
 */
@Controller('appearance')
@UseGuards(PublicReadGuard)
export class AppearancePublicController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  @Header('Cache-Control', 'no-cache')
  get(): Promise<AppAppearance> {
    return this.appearance.getPublic();
  }
}
